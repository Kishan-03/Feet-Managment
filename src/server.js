const app = require("./app");
const config = require("./config");

app.listen(config.port, () => {
  console.log(`FleetOps API listening on http://localhost:${config.port}`);
  console.log(`Database: ${config.dbFile}`);
});
