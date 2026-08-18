/** Version of the shareable URL-backed card fragment contract. */
const CARD_LINK_VERSION = "1";

/** Validate and normalize one remotely retrievable image URL. */
function validateRemoteImageUrl(value, field_name)
{
    let url;
    try
    {
        url = new URL(value);
    }
    catch(error)
    {
        throw(new Error(`${field_name} is not a valid absolute URL.`));
    }
    if(url.protocol != "https:" && url.protocol != "http:")
    {
        throw(new Error(`${field_name} must use HTTP or HTTPS.`));
    }
    return url.href;
}

/** Return one required, non-duplicated card-link parameter. */
function requireCardLinkParameter(parameters, name)
{
    const values = parameters.getAll(name);
    if(values.length != 1 || values[0].trim() == "")
    {
        throw(new Error(`Card link requires exactly one ${name} value.`));
    }
    return values[0];
}

/** Return one optional, non-duplicated card-link parameter. */
function optionalCardLinkParameter(parameters, name)
{
    const values = parameters.getAll(name);
    if(values.length == 0)
    {
        return null;
    }
    if(values.length != 1 || values[0].trim() == "")
    {
        throw(new Error(`Card link permits at most one nonempty ${name}.`));
    }
    return values[0];
}

/** Encode remote artwork and optional controls into a versioned fragment. */
function encodeCardLink(page_url, artwork_url, control_url)
{
    const parameters = new URLSearchParams();
    parameters.set("v", CARD_LINK_VERSION);
    parameters.set(
        "artwork", validateRemoteImageUrl(artwork_url, "Artwork URL"));
    if(control_url != null)
    {
        parameters.set(
            "controls", validateRemoteImageUrl(control_url, "Control URL"));
    }

    const url = new URL(page_url);
    url.hash = parameters.toString();
    return url.href;
}

/** Parse a card fragment, returning null when the fragment is unrelated. */
function parseCardLink(page_url)
{
    const url = new URL(page_url);
    if(url.hash == "")
    {
        return null;
    }

    const parameters = new URLSearchParams(url.hash.slice(1));
    const card_names = ["v", "artwork", "controls"];
    if(!card_names.some(function hasCardParameter(name)
    {
        return parameters.has(name);
    }))
    {
        return null;
    }

    const version = requireCardLinkParameter(parameters, "v");
    if(version != CARD_LINK_VERSION)
    {
        throw(new Error(`Unsupported card-link version: ${version}.`));
    }
    const artwork_url = requireCardLinkParameter(parameters, "artwork");
    const control_url = optionalCardLinkParameter(parameters, "controls");
    return {
        artwork_url: validateRemoteImageUrl(artwork_url, "Artwork URL"),
        control_url: control_url == null
            ? null
            : validateRemoteImageUrl(control_url, "Control URL"),
    };
}

/** Remove any fragment from a page URL and return the resulting URL. */
function clearCardLink(page_url)
{
    const url = new URL(page_url);
    url.hash = "";
    return url.href;
}

if(typeof module != "undefined")
{
    module.exports = {
        CARD_LINK_VERSION,
        clearCardLink,
        encodeCardLink,
        parseCardLink,
        validateRemoteImageUrl,
    };
}
