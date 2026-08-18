const assert = require("assert");
const {
    CARD_LINK_VERSION,
    clearCardLink,
    encodeCardLink,
    parseCardLink,
    parseUniformControl,
    validateRemoteImageUrl,
} = require("../card_link.js");

/** Preserve nested queries and fragments through card-link encoding. */
function testCardLinkRoundTrip()
{
    const page_url = "https://cards.example/view?quality=high#old";
    const artwork_url =
        "https://images.example/art.webp?size=large&token=a+b#crop";
    const control_url =
        "https://cdn.example/foil.avif?name=red%20card&version=2";
    const encoded = encodeCardLink(
        page_url, artwork_url, control_url);
    const page = new URL(encoded);
    assert.equal(page.search, "?quality=high");
    assert.equal(
        new URLSearchParams(page.hash.slice(1)).get("v"),
        CARD_LINK_VERSION);
    assert.deepEqual(parseCardLink(encoded), {
        artwork_url,
        control_url,
        control_color: null,
    });
}

/** Preserve uniform controls when no control image URL is available. */
function testCardLinkWithUniformControls()
{
    const control_color = [155, 64, 8, 255];
    const encoded = encodeCardLink(
        "https://cards.example/", "https://images.example/art.webp", null,
        control_color);
    const parameters = new URLSearchParams(new URL(encoded).hash.slice(1));
    assert.equal(parameters.has("controls"), false);
    assert.equal(parameters.get("rgba"), "155,64,8,255");
    assert.deepEqual(parseCardLink(encoded), {
        artwork_url: "https://images.example/art.webp",
        control_url: null,
        control_color,
    });
}

/** Ignore ordinary anchors that do not claim the card-link namespace. */
function testUnrelatedFragment()
{
    assert.equal(
        parseCardLink("https://cards.example/#instructions"), null);
    assert.equal(parseCardLink("https://cards.example/"), null);
}

/** Reject incomplete, ambiguous, unsupported, and local card links. */
function testInvalidCardLinks()
{
    assert.throws(function rejectEmptyControls()
    {
        parseCardLink(
            "https://cards.example/#v=1&artwork=https%3A%2F%2Fa.test%2Fa"
            + "&controls=");
    }, /controls/);
    assert.throws(function rejectDuplicateArtwork()
    {
        parseCardLink(
            "https://cards.example/#v=1&artwork=https%3A%2F%2Fa.test%2Fa"
            + "&artwork=https%3A%2F%2Fa.test%2Fb"
            + "&controls=https%3A%2F%2Fa.test%2Fc");
    }, /artwork/);
    assert.throws(function rejectUnknownVersion()
    {
        parseCardLink(
            "https://cards.example/#v=2&artwork=https%3A%2F%2Fa.test%2Fa"
            + "&controls=https%3A%2F%2Fa.test%2Fc");
    }, /version/);
    assert.throws(function rejectMalformedUniformControl()
    {
        parseUniformControl("0,1,2,256");
    }, /four comma-separated bytes/);
    assert.throws(function rejectAmbiguousUniformWhitespace()
    {
        parseUniformControl("0, 1,2,3");
    }, /four comma-separated bytes/);
    assert.throws(function rejectAmbiguousControls()
    {
        parseCardLink(
            "https://cards.example/#v=1&artwork=https%3A%2F%2Fa.test%2Fa"
            + "&controls=https%3A%2F%2Fa.test%2Fc&rgba=0%2C0%2C0%2C0");
    }, /both/);
    assert.throws(function rejectBlobUrl()
    {
        validateRemoteImageUrl("blob:https://cards.example/id", "Artwork");
    }, /HTTP/);
    assert.throws(function rejectRelativeUrl()
    {
        validateRemoteImageUrl("images/card.png", "Artwork");
    }, /absolute/);
}

/** Clear the fragment without changing the page path or query. */
function testClearCardLink()
{
    assert.equal(
        clearCardLink("https://cards.example/view?q=1#v=1"),
        "https://cards.example/view?q=1");
}

testCardLinkRoundTrip();
testCardLinkWithUniformControls();
testUnrelatedFragment();
testInvalidCardLinks();
testClearCardLink();
console.log("card_link_test: passed");
