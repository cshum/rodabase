if(process.browser){
  //shim
  require("indexeddbshim");
  require("setimmediate");
}
module.exports = require('./lib/roda');
