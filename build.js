const fs = require("fs");
const inline = require("web-resource-inliner");
const JavaScriptObfuscator = require('javascript-obfuscator');
const minifier = require('html-minifier');

function normalize(contents) {
    return process.platform === "win32" ? contents.replace(/\r\n/g, "\n") : contents;
}

function readFile(file) {
    return normalize(fs.readFileSync(file, "utf8"));
}

const keywords = ['do', 'if', 'in', 'for', 'int', 'let', 'new', 'try', 'var'];

const identifiers = [];
{
    for (let i = 0; i < 26; i++) {
        for (let j = 0; j < 2; j++) {
            if (i == 0) identifiers.push(String.fromCharCode(97 + j));

            const id = String.fromCharCode(97 + i) + String.fromCharCode(97 + j);

            if (keywords.includes(id)) continue;

            identifiers.push(id);
        }
    }
}

let scriptId = 0;

inline.html({
    fileContent: readFile("src/index.html"),
    relativeTo: "src/",
    images: 100,
    scriptTransform: function (content, done) {
        try {
            const result = JavaScriptObfuscator.obfuscate(
                content.toString(),
                {
                    identifierNamesGenerator: 'dictionary',
                    identifiersDictionary: identifiers,
                    identifiersPrefix: String.fromCharCode(97 + scriptId++),
                    compact: true,
                    simplify: true,
                    // controlFlowFlattening: true,
                    // numbersToExpressions: true,
                    // shuffleStringArray: true,
                    // splitStrings: true
                }).getObfuscatedCode();

            done(null, result);
        } catch (err) {
            console.log(err);
        }
    }
},
    async function (err, result) {
        result = minifier.minify(result, {
            removeAttributeQuotes: true,
            minifyJS: true,
            minifyCSS: true,
            collapseWhitespace: true,
            removeComments: true,
            removeRedundantAttributes: true,
        });

        if (!fs.existsSync("dist")) {
            fs.mkdirSync("dist");
        }

        fs.writeFileSync("dist/index.html", result, "utf8");
        fs.copyFileSync("src/branch.png", "dist/branch.png");
        fs.copyFileSync("src/favicon.png", "dist/favicon.png");
    }
);
