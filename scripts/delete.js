const glob = require("glob")
const fs = require('fs');

glob("../lib/antv/G2Plot-master/**/*.en.md", function (er, files) {
    files.forEach(path => {
        fs.unlinkSync(path)
    })
})
