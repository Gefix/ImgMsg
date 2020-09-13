var imgmsg = ImgMsg('webgl', 'w', 'i', 'm', 'p', 'msgimgpb', 'imgmsgpb', 120, -51);

(_ => {
    const image = document.getElementById('i');

    const defaultImageSrc = 'branch.png';

    const logo = document.getElementById("logo");
    document.getElementById("favicon").setAttribute("href", logo.src);
    image.src = logo.src;

    async function askWritePermission() {
        try {
            const { state } = await navigator.permissions.query({ name: 'clipboard-write', allowWithoutGesture: false })
            return state === 'granted'
        } catch (error) {
            return false
        }
    }

    function showLogoImage() {
        if (image.style.visibility != 'visible') {
            image.style.visibility = 'visible';
            imgmsg.drawImageOnCanvas(image);
        }
    }

    function activeInput() {
        return ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
    }

    function loadImageFile(src, file) {
        if (src) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onabort = showLogoImage;
            img.onerror = showLogoImage;
            img.onload = async function () {
                await imgmsg.drawImageOnCanvas(img);
                image.style.visibility = 'visible';
            }
            img.src = src;
        } else if (file) {
            const reader = new FileReader();
            reader.onload = function (event) {
                const img = new Image();

                img.style.background = 'none!important';

                img.onload = async function () {
                    await imgmsg.drawImageOnCanvas(img);
                }

                img.src = event.target.result;
            }
            reader.readAsDataURL(file);
        }
    }

    try {
        const urlParams = new URLSearchParams(window.location.search);
        const imageSrc = urlParams.get('i');

        loadImageFile(imageSrc || defaultImageSrc);
    } catch { }

    addEventListener('resize', function () {
        if (activeInput()) {
            setTimeout(function () {
                document.activeElement.scrollIntoView(true);
            }, 0);
        }
    });

    function scrollIntoView() {
        setTimeout(() => {
            if (activeInput()) return;

            document.body.scrollIntoView(true)
        }, 200);
    }

    function doOnOrientationChange() {
        const viewport = document.getElementById("vp");
        let viewport_width = 592;
        switch (window.orientation) {
            case -90:
            case 90:
                viewport_width = (viewport_width * window.screen.width / window.screen.height) | 0;
                break;
            default:
                break;
        }
        vp.setAttribute('content', `width=${viewport_width}, user-scalable=0`);
        scrollIntoView();
    }

    window.addEventListener('orientationchange', doOnOrientationChange);

    doOnOrientationChange();

    async function init() {

        const canCopy = await askWritePermission();
        if (!canCopy) {
            document.getElementById('copybtn').outerHTML = '';
        } else {
            document.getElementById('copybtn').hidden = false;
        }

        if ('ontouchstart' in window) {
            document.getElementById('savett').innerHTML = 'Touch and hold the image<br />and <span class="italic">Download image</span><br />or <span class="italic">Share image</span>'
        }

        image.addEventListener('dragover', (event) => {
            event.stopPropagation();
            event.preventDefault();

            event.dataTransfer.dropEffect = 'copy';
        });

        image.addEventListener('drop', async (event) => {
            event.stopPropagation();
            event.preventDefault();

            const dt = event.dataTransfer;
            const types = ['URL', ...dt.types];

            let el = null;

            for (let i = 0; el == null && i < types.length; i++) {
                el = dt.getData(types[i]) || null;
                if (el && (!(el.startsWith('data:image/png;base64,')) && !(el.startsWith('data:image/bmp;base64,')) && !(el.startsWith('http')))) {
                    el = null;
                }
            }

            if (el) {
                el = el.split('\n')[0];
            }

            const file = dt.files[0] || null;

            loadImageFile(el, file);
        });

        document.body.oncopy = async () => {
            if (activeInput()) return;

            imgmsg.copyToClipboard();
        }

        document.body.onpaste = async (event) => {
            if (activeInput()) return;

            let el = event.clipboardData.getData('text/plain') || null;

            if (el && (!(el.startsWith('data:image/png;base64,')) && !(el.startsWith('data:image/bmp;base64,')) && !(el.startsWith('http')))) {
                el = null;
            }

            const file = event.clipboardData.files[0] || null;

            loadImageFile(el, file);
        }

        document.body.onclick = () => {
            scrollIntoView();
        }
    }

    init();
})();