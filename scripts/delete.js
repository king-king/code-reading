const glob = require("glob")
const fs = require('fs');

glob("../lib/G2-master/**/*.en.md", function (er, files) {
    files.forEach(path => {
        fs.unlinkSync(path)
    })
})
