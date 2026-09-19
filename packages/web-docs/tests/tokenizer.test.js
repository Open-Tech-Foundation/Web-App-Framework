import { expect, test } from "../../web-cli/tests/harness.js";
import vectors from "../search/tokenizer-vectors.json" with { type: "json" };
import { tokenize } from "../search.js";

test("matches the shared tokenizer vectors", () => {
  for (const vector of vectors) expect(tokenize(vector.input)).toEqual(vector.tokens);
});
