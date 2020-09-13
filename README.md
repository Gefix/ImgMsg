  ___                 __  __           
 |_ _|_ __ ___   __ _|  \/  |___  __ _ 
  | || '_ ` _ \ / _` | |\/| / __|/ _` |
  | || | | | | | (_| | |  | \__ \ (_| |
 |___|_| |_| |_|\__, |_|  |_|___/\__, |
                |___/            |___/   v1.2

    by Dimitar Blagoev (Gef[r]ix)

# Building for production
npm run build

# Debugging
npm run start

# About
Encode long messages as small color fluctuations,
indistinguishable from white noise.

The message is first compressed using Pieroxy's lz-string,
then encrypted using industry standard AES-256 encryption
with the 256th SHA256 hash derivative of the salted password,
then protected against errors using G24 extended Golay code,
and, finally, scattered bit-by-bit on the chosen target image
into random places with a PRNG using a derivative of the hash
of the password, so that each password scatters the encoded
message into a different random set of bits of sub-pixels
in the image.

By utilizing the random bit-level scattering the encoded
message appears to be random noise, or a loss in the image's
color quality.

Note that for the message to be decodable, the image must be
saved using a lossless compression.
PNG images are ok but JPEGs are not!

Multiple messages can be encoded into the same image with
different passwords. The number of messages is proportional
to their length. 
Long messages of more than 4KB can rarely coexist with others.
If the messages are, however, short (less than 128 characters)
it may be possible to hide over 20 messages in the same image.

This very image contains several other hidden messages encoded
with different passwords.

This is an entirely static single-page application. Absolutely
no data is sent to the server after the page has loaded.

All image processing is done entirely inside the browser.
