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

/** Validate one serialized uniform RGBA control and return its bytes. */
function parseUniformControl(value)
{
    const parts = String(value).split(",");
    const channels = parts.map(function parseChannel(channel)
    {
        return Number(channel);
    });
    if(parts.length != 4
       || !parts.every(function validateChannel(part, index)
       {
           return /^(0|[1-9][0-9]{0,2})$/.test(part)
               && channels[index] <= 255;
       }))
    {
        throw(new Error(
            "Uniform RGBA control must contain four comma-separated bytes."));
    }
    return channels;
}

/** Encode remote images or uniform controls into a versioned fragment. */
function encodeCardLink(page_url, artwork_url, control_url, control_color)
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
    else
    {
        parameters.set("rgba", parseUniformControl(
            Array.isArray(control_color)
                ? control_color.join(",") : "").join(","));
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
    const card_names = ["v", "artwork", "controls", "rgba"];
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
    const uniform_value = optionalCardLinkParameter(parameters, "rgba");
    if(control_url != null && uniform_value != null)
    {
        throw(new Error(
            "Card link cannot specify both an image and uniform controls."));
    }
    return {
        artwork_url: validateRemoteImageUrl(artwork_url, "Artwork URL"),
        control_url: control_url == null
            ? null
            : validateRemoteImageUrl(control_url, "Control URL"),
        control_color: uniform_value == null
            ? null
            : parseUniformControl(uniform_value),
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
        parseUniformControl,
        validateRemoteImageUrl,
    };
}
