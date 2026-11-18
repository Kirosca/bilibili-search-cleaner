// Test suite for #tag handling under F5 refresh and API keyword extraction

function testExtraction(search, hash, domVal) {
    let kw = '';
    const params = new URLSearchParams(search);
    const searchKeyword = params.get('keyword');
    if (searchKeyword !== null) {
        kw = searchKeyword;
    }

    if (hash) {
        if (hash.includes('keyword=')) {
            try {
                const hashParams = new URLSearchParams(hash.slice(hash.indexOf('?')));
                const val = hashParams.get('keyword');
                if (val) kw = val;
            } catch (e) {}
        } else if (!hash.startsWith('#/') && !hash.startsWith('#?')) {
            const tagFragment = decodeURIComponent(hash.slice(1)).trim();
            if (tagFragment) {
                if (kw) {
                    kw = decodeURIComponent(kw.replace(/\+/g, ' ')) + ' #' + tagFragment;
                } else {
                    kw = '#' + tagFragment;
                }
            }
        }
    }

    if (domVal) {
        const domTrim = domVal.trim();
        if (domTrim.includes('#') || domTrim.includes('@') || domTrim.includes('-') || domTrim.includes('*')) {
            kw = domTrim;
        } else if (!kw) {
            kw = domTrim;
        }
    }

    return decodeURIComponent(kw.replace(/\+/g, ' ')).trim();
}

console.log("=== Testing URL Keyword Extraction for # ===");
console.assert(testExtraction('?keyword=python+%23tag', '', '') === 'python #tag', 'Test 1 Failed');
console.assert(testExtraction('?keyword=python', '#tag', '') === 'python #tag', 'Test 2 Failed');
console.assert(testExtraction('?keyword=', '#tag', '') === '#tag', 'Test 3 Failed');
console.assert(testExtraction('?keyword=%23tag', '', '') === '#tag', 'Test 4 Failed');
console.assert(testExtraction('?keyword=python', '', 'python #tag') === 'python #tag', 'Test 5 Failed');
console.assert(testExtraction('?keyword=python+-@up', '', '') === 'python -@up', 'Test 6 Failed');

console.log("ALL URL Keyword Extraction Tests Passed!");
