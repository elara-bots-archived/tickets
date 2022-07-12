const package = require("./package.json");
console.log([
    `Package: ${package.name}`,
    `────────────────────────`,
    `Thanks for installing the package!`,
    `Version you installed: ${package.version}`,
    `─────────────────────────────────────────`,
    `To get started look at the 'Getting Started' section on the npm page here: https://www.npmjs.com/package/@elara-services/tickets`,
    `Here is some helpful links:`,
    `Source Code: https://github.com/elara-bots/tickets`,
    `Support: https://discord.gg/qafHJ63`
].join("\n"))