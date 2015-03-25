var _         = require('underscore'),
    bytewise  = require('bytewise');

module.exports = {
  encode: function(){
    return bytewise
      .encode(_.flatten(arguments))
      .toString('binary');
  },
  stringArray: function(){
    var key = _.flatten(arguments).map(String);
    return key.length === 1 ? key[0]:key;
  }
};
