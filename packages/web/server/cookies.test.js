import { describe, expect, test } from "bun:test";

import { deleteCookie, getCookie, getCookies, serializeCookie, setCookie } from "./cookies.js";

const req = (cookie) => new Request("http://localhost/", cookie ? { headers: { cookie } } : {});

describe("getCookies / getCookie", () => {
  test("parses the Cookie header of a Request into { name: value }", () => {
    expect(getCookies(req("a=1; b=two"))).toEqual({ a: "1", b: "two" });
    expect(getCookie(req("a=1; b=two"), "b")).toBe("two");
  });

  test("accepts a Headers object or the raw header string", () => {
    expect(getCookies(new Headers({ cookie: "a=1" }))).toEqual({ a: "1" });
    expect(getCookies("a=1; b=2")).toEqual({ a: "1", b: "2" });
  });

  test("no cookies → empty object / undefined", () => {
    expect(getCookies(req())).toEqual({});
    expect(getCookie(req(), "nope")).toBeUndefined();
    expect(getCookies("")).toEqual({});
  });

  test("values are percent-decoded; malformed encoding stays raw", () => {
    expect(getCookie("name=John%20Doe", "name")).toBe("John Doe");
    expect(getCookie("raw=100%zz", "raw")).toBe("100%zz");
  });

  test("tolerates spacing, empty segments, quoted values, and = in the value", () => {
    expect(getCookies("a=1;  b = 2 ;; c")).toEqual({ a: "1", b: "2" });
    expect(getCookie('q="hello"', "q")).toBe("hello");
    expect(getCookie("jwt=abc=def==", "jwt")).toBe("abc=def==");
  });

  test("on a duplicate name the first occurrence wins (RFC 6265 §5.4)", () => {
    expect(getCookie("dup=first; dup=second", "dup")).toBe("first");
  });
});

describe("serializeCookie", () => {
  test("percent-encodes the value and defaults Path=/", () => {
    expect(serializeCookie("name", "John Doe")).toBe("name=John%20Doe; Path=/");
  });

  test("path: null omits the Path attribute", () => {
    expect(serializeCookie("a", "1", { path: null })).toBe("a=1");
  });

  test("renders every attribute", () => {
    const s = serializeCookie("sid", "tok", {
      path: "/app",
      domain: "example.com",
      maxAge: 3600.9,
      expires: new Date("2027-01-01T00:00:00Z"),
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      partitioned: true,
    });
    expect(s).toBe(
      "sid=tok; Path=/app; Domain=example.com; Max-Age=3600; " +
        "Expires=Fri, 01 Jan 2027 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax; Partitioned",
    );
  });

  test("a serialized cookie round-trips through getCookie", () => {
    const value = 'weird; value="with, everything" 100%';
    const s = serializeCookie("v", value);
    expect(getCookie(s.split(";")[0], "v")).toBe(value);
  });

  test("rejects invalid names, maxAge, expires, and sameSite loudly", () => {
    expect(() => serializeCookie("bad name", "v")).toThrow(TypeError);
    expect(() => serializeCookie("bad;name", "v")).toThrow(TypeError);
    expect(() => serializeCookie("a", "v", { maxAge: NaN })).toThrow(TypeError);
    expect(() => serializeCookie("a", "v", { expires: "not a date" })).toThrow(TypeError);
    expect(() => serializeCookie("a", "v", { sameSite: "sideways" })).toThrow(TypeError);
  });

  test("SameSite=None without Secure fails at write time (browsers reject it)", () => {
    expect(() => serializeCookie("a", "v", { sameSite: "None" })).toThrow(/secure/);
    expect(serializeCookie("a", "v", { sameSite: "None", secure: true })).toContain(
      "Secure; SameSite=None",
    );
  });
});

describe("setCookie / deleteCookie", () => {
  test("appends Set-Cookie to a Response; multiple cookies coexist", () => {
    const res = Response.json({ ok: true });
    setCookie(res, "session", "tok", { httpOnly: true });
    setCookie(res, "csrf", "xyz");
    const cookies = res.headers.getSetCookie();
    expect(cookies).toEqual(["session=tok; Path=/; HttpOnly", "csrf=xyz; Path=/"]);
  });

  test("accepts a bare Headers target and returns the serialized value", () => {
    const headers = new Headers();
    const s = setCookie(headers, "a", "1");
    expect(s).toBe("a=1; Path=/");
    expect(headers.get("set-cookie")).toBe("a=1; Path=/");
  });

  test("deleteCookie expires with Max-Age=0 and the epoch, honoring path/domain", () => {
    const res = new Response(null);
    deleteCookie(res, "session", { path: "/app", domain: "example.com" });
    expect(res.headers.get("set-cookie")).toBe(
      "session=; Path=/app; Domain=example.com; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    );
  });
});
