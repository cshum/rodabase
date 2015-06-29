module.exports = function(){
  var args = Array.prototype.slice(arguments);
  var range = args.pop();
  var prefix = '!'+args.join('#')+'!';
};
