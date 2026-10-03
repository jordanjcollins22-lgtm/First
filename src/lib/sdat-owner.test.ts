import { describe, expect, it } from "vitest";

import { pageLines, parseSdatOwner } from "./sdat-owner";

const page = `
<html><body><table>
<tr><td class="label">Owner Information</td></tr>
<tr><td>Owner Name:</td><td><span id="lblOwnerName">SMITH JOHN A<br/>SMITH JANE B</span></td></tr>
<tr><td>Use:</td><td>RESIDENTIAL</td></tr>
<tr><td>Principal Residence:</td><td>YES</td></tr>
<tr><td>Mailing Address:</td><td>208 CRAFTON RD<br>BEL AIR MD 21014-1234</td></tr>
<tr><td>Deed Reference:</td><td>/12345/ 00678</td></tr>
</table><script>var x = "Owner Name: NOT THIS";</script></body></html>`;

describe("parseSdatOwner", () => {
  it("reads the names, the mailing address and the principal-residence answer", () => {
    expect(parseSdatOwner(page)).toEqual({
      ownerName: "SMITH JOHN A & SMITH JANE B",
      mailing: "208 CRAFTON RD, BEL AIR MD 21014-1234",
      principalResidence: true,
    });
  });
  it("takes a value on the label's own line and says nothing when the page is not a record", () => {
    expect(parseSdatOwner("<p>Owner Name: ACME HOLDINGS LLC</p><p>Principal Residence: NO</p>")).toEqual({
      ownerName: "ACME HOLDINGS LLC",
      mailing: null,
      principalResidence: false,
    });
    expect(parseSdatOwner("<html><body><h1>Search</h1><p>No records found.</p></body></html>")).toBeNull();
  });
  it("turns the page into lines without tags or scripts", () => {
    expect(pageLines("<div>A &amp; B</div><script>x</script><span>C</span>")).toEqual(["A & B", "C"]);
  });
});
