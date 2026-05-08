const glob = require('glob');
const fs = require('fs');

const updateRequires = (filePath) => {
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/.cjs/g, ".js");
  fs.writeFileSync(filePath, content, 'utf8');
};

async function main() {
  const files = await glob.glob('./esm/**/*.js', { nodir: true });
  files.forEach((file) => {
    updateRequires(file);
  });
}

main();
