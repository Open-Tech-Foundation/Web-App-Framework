//! Deal with several changes in events, batching them together.
//!
//! Preferably, changes should be kept to a minimum.
//! Sometimes, it’s needed to change the list of events, because parsing can be
//! messy, and it helps to expose a cleaner interface of events to the compiler
//! and other users.
//! It can also help to merge many adjacent similar events.
//! And, in other cases, it’s needed to parse subcontent: pass some events
//! through another tokenizer and inject the result.

use crate::event::Event;
use alloc::collections::BTreeMap;
use alloc::{vec, vec::Vec};

/// Shift `previous` and `next` links according to `jumps`.
///
/// This fixes links in case there are events removed or added between them.
fn shift_links(events: &mut [Event], jumps: &[(usize, usize, usize)]) {
    let mut jump_index = 0;
    let mut index = 0;
    let mut add = 0;
    let mut rm = 0;

    while index < events.len() {
        let rm_curr = rm;

        while jump_index < jumps.len() && jumps[jump_index].0 <= index {
            add = jumps[jump_index].2;
            rm = jumps[jump_index].1;
            jump_index += 1;
        }

        // Ignore items that will be removed.
        if rm > rm_curr {
            index += rm - rm_curr;
        } else {
            if let Some(link) = &events[index].link {
                if let Some(next) = link.next {
                    events[next].link.as_mut().unwrap().previous = Some(index + add - rm);

                    while jump_index < jumps.len() && jumps[jump_index].0 <= next {
                        add = jumps[jump_index].2;
                        rm = jumps[jump_index].1;
                        jump_index += 1;
                    }

                    events[index].link.as_mut().unwrap().next = Some(next + add - rm);
                    index = next;
                    continue;
                }
            }

            index += 1;
        }
    }
}

/// Tracks a bunch of edits.
#[derive(Debug)]
pub struct EditMap {
    /// Record of changes.
    map: Vec<(usize, usize, Vec<Event>)>,
    /// **OTF Web fork** — `at` → its index in `map`, so [`add_impl`] can find an
    /// existing edit at the same position by lookup instead of scanning `map`.
    /// See `FORK.md`; the scan made parsing quadratic in document length.
    index: BTreeMap<usize, usize>,
}

impl EditMap {
    /// Create a new edit map.
    pub fn new() -> EditMap {
        EditMap { map: vec![], index: BTreeMap::new() }
    }
    /// Create an edit: a remove and/or add at a certain place.
    pub fn add(&mut self, index: usize, remove: usize, add: Vec<Event>) {
        add_impl(self, index, remove, add, false);
    }
    /// Create an edit: but insert `add` before existing additions.
    pub fn add_before(&mut self, index: usize, remove: usize, add: Vec<Event>) {
        add_impl(self, index, remove, add, true);
    }
    /// Done, change the events.
    pub fn consume(&mut self, events: &mut Vec<Event>) {
        self.map
            .sort_unstable_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

        if self.map.is_empty() {
            return;
        }

        // Calculate jumps: where items in the current list move to.
        let mut jumps = Vec::with_capacity(self.map.len());
        let mut index = 0;
        let mut add_acc = 0;
        let mut remove_acc = 0;
        while index < self.map.len() {
            let (at, remove, add) = &self.map[index];
            remove_acc += remove;
            add_acc += add.len();
            jumps.push((*at, remove_acc, add_acc));
            index += 1;
        }

        shift_links(events, &jumps);

        let len_before = events.len();
        let mut index = self.map.len();
        let mut vecs = Vec::with_capacity(index * 2 + 1);
        while index > 0 {
            index -= 1;
            vecs.push(events.split_off(self.map[index].0 + self.map[index].1));
            vecs.push(self.map[index].2.split_off(0));
            events.truncate(self.map[index].0);
        }
        vecs.push(events.split_off(0));

        events.reserve(len_before + add_acc - remove_acc);

        while let Some(mut slice) = vecs.pop() {
            events.append(&mut slice);
        }

        self.map.truncate(0);
        self.index.clear();
    }
}

/// Create an edit.
fn add_impl(edit_map: &mut EditMap, at: usize, remove: usize, mut add: Vec<Event>, before: bool) {
    if remove == 0 && add.is_empty() {
        return;
    }

    // **OTF Web fork** — upstream walks `map` from 0 looking for an edit already
    // registered at `at`. `map` grows with the document (roughly one entry per
    // content chunk), and every construct's resolver plus `subtokenize` calls
    // `add`, so that scan is what made parsing quadratic in document length.
    // `index` answers the same question in O(log n). `map`'s order is not
    // meaningful — `consume` sorts by `at`, and this merge is what guarantees
    // `at` values stay unique — so keying by `at` is an exact replacement.
    if let Some(&index) = edit_map.index.get(&at) {
        edit_map.map[index].1 += remove;

        if before {
            add.append(&mut edit_map.map[index].2);
            edit_map.map[index].2 = add;
        } else {
            edit_map.map[index].2.append(&mut add);
        }

        return;
    }

    edit_map.index.insert(at, edit_map.map.len());
    edit_map.map.push((at, remove, add));
}

/// **OTF Web fork** — upstream ships no tests on crates.io, so these pin the
/// behaviour the `index` lookup replaced: edits at the same position merge (and
/// merge in the right order), edits at distinct positions do not, and a consumed
/// map starts clean. See `FORK.md`.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::{Kind, Name, Point};

    fn event(line: usize) -> Event {
        Event {
            kind: Kind::Enter,
            name: Name::Data,
            point: Point { line, column: 1, index: line, vs: 0 },
            link: None,
        }
    }

    /// The `(at, remove, add-lines)` view of a map, in `consume` order.
    fn shape(map: &EditMap) -> Vec<(usize, usize, Vec<usize>)> {
        let mut rows: Vec<_> = map
            .map
            .iter()
            .map(|(at, remove, add)| {
                (*at, *remove, add.iter().map(|e| e.point.line).collect::<Vec<_>>())
            })
            .collect();
        rows.sort_by_key(|r| r.0);
        rows
    }

    #[test]
    fn edits_at_the_same_position_merge() {
        let mut map = EditMap::new();
        map.add(4, 1, vec![event(1)]);
        map.add(4, 2, vec![event(2)]);
        assert_eq!(shape(&map), vec![(4, 3, vec![1, 2])], "removes sum, adds append");
    }

    #[test]
    fn add_before_prepends_at_the_same_position() {
        let mut map = EditMap::new();
        map.add(4, 0, vec![event(1)]);
        map.add_before(4, 0, vec![event(2)]);
        assert_eq!(shape(&map), vec![(4, 0, vec![2, 1])], "`add_before` goes in front");
    }

    #[test]
    fn distinct_positions_stay_separate() {
        let mut map = EditMap::new();
        // Out of order on purpose: the lookup must key on `at`, not on arrival.
        map.add(9, 0, vec![event(1)]);
        map.add(2, 0, vec![event(2)]);
        map.add(9, 0, vec![event(3)]);
        assert_eq!(shape(&map), vec![(2, 0, vec![2]), (9, 0, vec![1, 3])]);
    }

    #[test]
    fn an_empty_edit_is_dropped() {
        let mut map = EditMap::new();
        map.add(4, 0, vec![]);
        assert!(shape(&map).is_empty(), "a no-op edit must not register a position");
        // …and must not have claimed `4`, so a later real edit still lands there.
        map.add(4, 1, vec![event(1)]);
        assert_eq!(shape(&map), vec![(4, 1, vec![1])]);
    }

    #[test]
    fn consume_clears_the_position_index() {
        let mut events = vec![event(1), event(2), event(3)];
        let mut map = EditMap::new();
        map.add(1, 1, vec![event(9)]);
        map.consume(&mut events);
        assert_eq!(
            events.iter().map(|e| e.point.line).collect::<Vec<_>>(),
            vec![1, 9, 3],
            "the edit replaced event 1"
        );

        // Reusing the map must not resolve `1` to the consumed edit's slot.
        map.add(1, 1, vec![event(8)]);
        map.consume(&mut events);
        assert_eq!(events.iter().map(|e| e.point.line).collect::<Vec<_>>(), vec![1, 8, 3]);
    }
}
