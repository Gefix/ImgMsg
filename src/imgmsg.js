var ImgMsg = function (webglId, canvasId, imageId, messageId, passwordId, encodePbId, decodePbId, pbHeight, pbTop) {
    const maxDim = 1024;

    const webgl = document.getElementById(webglId);
    const canvas = document.getElementById(canvasId);
    const image = document.getElementById(imageId);
    const message = document.getElementById(messageId);
    const password = document.getElementById(passwordId);
    const encodePb = document.getElementById(encodePbId);
    const decodePb = document.getElementById(decodePbId);

    let firstLoad = true;

    const context = canvas.getContext('2d');
    const gl = webgl.getContext("webgl", {
        preserveDrawingBuffer: true,
        premultipliedAlpha: false,
        alpha: true,
        antialias: false,
        depth: false
    });

    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const salt = new Uint8Array(16);
    for (let i = 0; i < salt.length; i++) {
        salt[i] = ((4 - 2 * (i & 1)) << (i >> 2)) ^ 42;
    }

    const lengthsuffix = '.l'.repeat(42);

    const golay = Golay();

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function numberWithCommas(x) {
        return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    function transferCanvasToImage() {
        image.src = canvas.toDataURL('image/png', 1);
    }

    function toUint8Array(data) {
        if (data instanceof Uint8Array) return data;
        if (typeof data !== 'string') data = data.toString();
        return new TextEncoder('utf-8').encode(data);
    }

    function toUtf8String(data) {
        if (!(data instanceof Uint8Array)) return data;
        return new TextDecoder('utf-8').decode(data);
    }

    async function hashcrypt(pws) {
        let hash = pws;
        for (let i = 0; i < 256; i++) {
            const second_hash_length = hash.length + pws.length + 1;
            const second_hash = new Uint8Array(second_hash_length);
            second_hash.set(hash);
            second_hash.set(pws, hash.length);
            second_hash[second_hash_length - 1] = i;
            hash = new Uint8Array(await crypto.subtle.digest({ name: 'SHA-256' }, second_hash));
        }
        return hash;
    }

    async function encrypt(msg, pw) {
        const data = toUint8Array(msg);
        const pwa = toUint8Array(pw);
        const pws = new Uint8Array(salt.length + pwa.length);
        pws.set(salt);
        pws.set(pwa, salt.length);

        let hash = await hashcrypt(pws);

        let iv = await crypto.subtle.digest({ name: 'SHA-256' }, hash);
        iv = iv.slice(10, 26);

        const key = await crypto.subtle.importKey("raw", hash, { name: "AES-CBC", length: 256 }, false, ["encrypt", "decrypt"]);
        const encrypted = await crypto.subtle.encrypt({ name: "AES-CBC", iv: iv }, key, data);
        const result = new Uint8Array(encrypted);

        return [result, iv];
    }

    async function preprocess(pw) {
        const pwa = toUint8Array(pw);
        const pws = new Uint8Array(salt.length + pwa.length);
        pws.set(salt);
        pws.set(pwa, salt.length);

        let hash = await hashcrypt(pws);

        let iv = await crypto.subtle.digest({ name: "SHA-256" }, hash);
        iv = iv.slice(10, 26);

        return [hash, iv];
    }

    async function decrypt(msg, hash, iv) {
        const data = toUint8Array(msg);

        const key = await crypto.subtle.importKey("raw", hash, { name: "AES-CBC", length: 256 }, false, ["encrypt", "decrypt"]);
        const decrypted = await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv }, key, data);
        const result = new Uint8Array(decrypted);

        return result;
    }

    function sfc32(a, b, c, d) {
        return function () {
            a >>>= 0;
            b >>>= 0;
            c >>>= 0;
            d >>>= 0;
            var t = (a + b) | 0;
            a = b ^ b >>> 9;
            b = c + (c << 3) | 0;
            c = (c << 21 | c >>> 11);
            d = d + 1 | 0;
            t = t + d | 0;
            c = c + t | 0;
            return (t >>> 0) / 4294967296;
        }
    }

    function gatherBits(data, width, height) {
        const pixels_count = width * height;

        const gather = new Uint32Array(pixels_count * 3 * 4);

        let skipped = 0;
        for (let i = 0; i < pixels_count; i++) {
            let r = i;
            const y = height - 1 - (r % height); r = (r / height) | 0;
            const x = width - 1 - (r % width);
            const o = (y * width + x) * 4 + 3;

            if (data[o] === 255) {
                gather[i - skipped] = i;
            } else {
                skipped++;
            }
        }

        const available_pixels = pixels_count - skipped;

        for (let j = 1; j < 12; j++) {
            const o1 = available_pixels * j;
            const o2 = pixels_count * j;
            for (let i = 0; i < available_pixels; i++) {
                gather[o1 + i] = gather[i] + o2;
            }
        }

        return gather.slice(0, available_pixels * 12);
    }

    async function fadeOut(element) {
        await sleep(1);
        element.classList.add('fadeout');
        await sleep(100);
    }

    async function fadeIn(element) {
        element.classList.remove('fadeout');
        element.classList.add('fadein');
        await sleep(100);
        element.classList.remove('fadein');
        await sleep(1);
    }

    async function encodeProgressUpdate(value) {
        const height = (pbHeight * value) | 0;
        const top = (pbHeight - height + pbTop) | 0;
        if (value <= 0.1) {
            encodePb.classList.remove('animate');
            await sleep(1);
        } else {
            encodePb.classList.add('animate');
            await sleep(1);
        }
        encodePb.style.height = height + 'px';
        encodePb.style.top = top + 'px';
        await sleep(20);
    }

    async function decodeProgressUpdate(value) {
        if (value <= 0.1) {
            decodePb.classList.remove('animate');
            await sleep(1);
        } else {
            decodePb.classList.add('animate');
            await sleep(1);
        }
        decodePb.style.height = ((pbHeight * value) | 0) + 'px';
        await sleep(20);
    }

    async function drawImageOnCanvas(img) {
        let width = img.naturalWidth;
        let height = img.naturalHeight;

        if (width > height) {
            if (width > maxDim) {
                height = (height * maxDim / width) | 0;
                width = maxDim;
            }
        } else {
            if (height > maxDim) {
                width = (width * maxDim / height) | 0;
                height = maxDim;
            }
        }

        canvas.width = width;
        canvas.height = height;
        context.clearRect(0, 0, width, height);

        try {
            if (width == img.naturalWidth && height == img.naturalHeight) {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
                const data = new Uint8Array(width * height * 4);
                gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);

                const imgdata = new ImageData(width, height);
                imgdata.data.set(new Uint8ClampedArray(data));

                context.putImageData(imgdata, 0, 0);
            } else {
                const bitmap = await createImageBitmap(img, 0, 0, img.naturalWidth, img.naturalHeight,
                    {
                        premultiplyAlpha: 'none',
                        colorSpaceConversion: 'none',
                        resizeQuality: 'pixelated'
                    });
                context.drawImage(bitmap, 0, 0, width, height);
            }
        } catch {
            context.drawImage(img, 0, 0, width, height);
        }

        if (firstLoad) {
            firstLoad = false;
            transferCanvasToImage();
        } else {
            await fadeOut(image);
            transferCanvasToImage();
            await fadeIn(image);
        }
    }

    const ImgMsg = {
        sfc32: sfc32,
        toUint8Array: toUint8Array,
        toUtf8String: toUtf8String,

        copyToClipboard: async function () {
            try {
                const permissionStatus = await navigator.permissions.query({ name: 'clipboard-write' });
                if (permissionStatus.state === 'granted') {
                    canvas.toBlob(async function (blob) {
                        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
                        await fadeOut(image);
                        await fadeIn(image);
                    }, 'image/png');
                }
            } catch {
                try {
                    await navigator.clipboard.writeText(image.src);
                    await fadeOut(image);
                    await fadeIn(image);
                } catch { }
            }
        },

        drawImageOnCanvas: drawImageOnCanvas,

        browseImage: function (e) {
            let reader = new FileReader();

            reader.onload = function (event) {
                let img = new Image();

                img.onload = async function () {
                    await drawImageOnCanvas(img);
                }
                img.src = event.target.result;
            }
            reader.readAsDataURL(e.target.files[0]);
            e.target.value = null;
        },

        encode: async function () {
            await encodeProgressUpdate(0.1);

            let msg = message.value;
            const Lmsg = toUint8Array(msg).length;

            msg = LZString.compressToUint8Array(msg);
            const Llzs = msg.length;

            await encodeProgressUpdate(0.28);

            const pwd = password.value;

            const [r] = await encrypt(msg, pwd);
            const [h, i] = await encrypt(r.length.toString(), pwd + lengthsuffix);

            const h2 = golay.EncodeUint8Array(h);
            const r2 = golay.EncodeUint8Array(r);

            const encmsg = new Uint8Array(r2.length + h2.length);

            encmsg.set(h2, 0);
            encmsg.set(r2, h2.length);

            const encmsglen = encmsg.length;

            const width = canvas.width;
            const height = canvas.height;

            let logo = context.getImageData(0, 0, width, height);

            let img = new ImageData(width, height);

            img.data.set(new Uint8ClampedArray(logo.data));
            const data = img.data;

            const seed = new Uint32Array(i);

            const rng = sfc32(seed[0], seed[1], seed[2], 1);
            for (let i = (1 << 16) + (seed[3] >> 16) + (seed[3] & 0xffff); i >= 0; i--) {
                rng();
            }

            await encodeProgressUpdate(0.46);

            const gather = gatherBits(data, width, height);
            const max_size = gather.length;

            // console.log(Lmsg, Llzs, encmsglen, max_size >> 3);

            if (encmsglen > max_size >> 3) {
                alert(`Encoded message of ${numberWithCommas(encmsglen)} bytes is too large.\nThe current image size is ${img.width} x ${img.height} pixels and can store ${numberWithCommas(max_size >> 3)} bytes.\nTransparent pixels cannot store hidden data.\nMaximum supported image size is ${maxDim} x ${maxDim} pixels.`);
                await encodeProgressUpdate(1);
                return;
            }

            await encodeProgressUpdate(0.64);

            let prev_r = 0;

            for (let k = 0; k < encmsglen; k++) {
                let cd = encmsg[k];

                for (let j = 0; j < 8; j++) {
                    const i = k * 8 + j;

                    let r = (Math.round(rng() * (max_size - i - 1)) + prev_r) % (max_size - i);
                    prev_r = r;

                    let g = gather[r];
                    gather[r] = gather[max_size - i - 1];
                    r = g;

                    let y = height - 1 - (r % height);
                    r = (r / height) | 0;
                    let x = width - 1 - (r % width);
                    r = (r / width) | 0;
                    const c = r % 3;
                    r = (r / 3) | 0;
                    const b = r % 7;
                    r = (r / 7) | 0;

                    const xor = 1 << (b);

                    const o = (y * img.width + x) * 4 + c;

                    if (cd % 2 == 1) {
                        data[o] |= xor;
                    } else {
                        data[o] &= ~xor;
                    }

                    cd >>= 1;
                }
            }

            context.putImageData(img, 0, 0);

            await encodeProgressUpdate(0.82);

            transferCanvasToImage();

            await encodeProgressUpdate(1);
        },

        decode: async function () {
            message.value = "";

            await decodeProgressUpdate(0.10);

            const width = canvas.width;
            const height = canvas.height;

            let logo = context.getImageData(0, 0, width, height);

            let img = new ImageData(width, height);

            img.data.set(new Uint8ClampedArray(logo.data));
            const data = img.data;

            const pwd = password.value;

            try {

                const [hash, iv] = await preprocess(pwd);
                const [hash_l, iv_l] = await preprocess(pwd + lengthsuffix);
                const seed = new Uint32Array(iv_l);

                const rng = sfc32(seed[0], seed[1], seed[2], 1);
                for (let i = (1 << 16) + (seed[3] >> 16) + (seed[3] & 0xffff); i >= 0; i--) {
                    rng();
                }

                await decodeProgressUpdate(0.28);

                const gather = gatherBits(data, width, height);
                const max_size = gather.length;

                let prev_r = 0;
                let prev_n = 0;

                const read = (n) => {
                    const result = new Uint8Array(n);

                    for (let k = 0; k < n; k++) {
                        let cd = 0;

                        for (let j = 0; j < 8; j++) {
                            const i = (k + prev_n) * 8 + j;

                            let r = (Math.round(rng() * (max_size - i - 1)) + prev_r) % (max_size - i);
                            prev_r = r;

                            let g = gather[r];
                            gather[r] = gather[max_size - i - 1];
                            r = g;

                            let y = height - 1 - (r % height);
                            r = (r / height) | 0;
                            let x = width - 1 - (r % width);
                            r = (r / width) | 0;
                            const c = r % 3;
                            r = (r / 3) | 0;
                            const b = r % 7;
                            r = (r / 7) | 0;

                            const xor = 1 << (b);

                            const o = (y * img.width + x) * 4 + c;

                            if ((data[o] & xor) == xor) {
                                cd |= 1 << j;
                            }
                        }

                        result[k] = cd;
                    }

                    prev_n += n;

                    return result;
                }

                const encheadersize = golay.EncodedSize(16);
                const encmsgenclen = golay.DecodeUint8Array(read(encheadersize), 16);

                const lengthtext = await decrypt(encmsgenclen, hash_l, iv_l);
                const encmsglen = parseInt(toUtf8String(lengthtext));

                await decodeProgressUpdate(0.46);

                if (encmsglen < 2 || encmsglen > max_size >> 3) {
                    throw "";
                }

                const encmsg = golay.DecodeUint8Array(read(golay.EncodedSize(encmsglen), encheadersize), encmsglen);

                let msg = await decrypt(encmsg, hash, iv);

                await decodeProgressUpdate(0.64);

                msg = LZString.decompressFromUint8Array(msg);

                await decodeProgressUpdate(0.82);

                if (msg === null) {
                    throw "";
                }

                message.value = msg;

                await decodeProgressUpdate(1);
            } catch (err) {
                message.value = "Incorrect password or image.";
                await decodeProgressUpdate(1);
            }
        }
    }

    return ImgMsg;
}
