const manifest = require('../package.json');
const { version } = manifest;
const tag = process.env.GITHUB_REF_NAME;
if (!tag || tag !== `v${version}`) {
    throw new Error(`Release tag ${JSON.stringify(tag)} must match v${version}`);
}
console.log(`Release version verified: ${tag}`);
if (process.argv[2]) {
    const yauzl = require('yauzl');
    yauzl.open(process.argv[2], { lazyEntries: true }, (error, zip) => {
        if (error) { console.error(error); process.exitCode = 1; return; }
        let found = false;
        zip.on('error', error => { console.error(error); process.exitCode = 1; });
        zip.on('entry', entry => {
            if (entry.fileName !== 'extension/package.json') { zip.readEntry(); return; }
            found = true;
            zip.openReadStream(entry, (streamError, stream) => {
                if (streamError) { console.error(streamError); process.exitCode = 1; zip.close(); return; }
                const chunks = [];
                stream.on('data', chunk => chunks.push(chunk));
                stream.on('error', error => { console.error(error); process.exitCode = 1; zip.close(); });
                stream.on('end', () => {
                    try {
                        const packaged = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                        for (const key of ['name', 'publisher', 'version']) {
                            if (packaged[key] !== manifest[key]) { throw new Error(`Packaged ${key} does not match release manifest`); }
                        }
                        console.log(`Release package verified: ${packaged.publisher}.${packaged.name}@${packaged.version}`);
                    } catch (error) { console.error(error); process.exitCode = 1; }
                    zip.close();
                });
            });
        });
        zip.on('end', () => { if (!found) { console.error('Missing extension/package.json'); process.exitCode = 1; } });
        zip.readEntry();
    });
}
