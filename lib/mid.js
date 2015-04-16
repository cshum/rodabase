var semaphore = require('./util').semaphore;

module.exports = function(db){
  var sema = semaphore(1);
  var mid = null;

  sema.take(function(){
    db.get('id', function(err, val){
      if(val){
        mid = val;
        sema.leave();
        return;
      }
      //should not start db if err
      var buf = require('crypto').randomBytes(6);

      mid = buf.toString('base64')
        .replace(/\//g,'_')
        .replace(/\+/g,'-');

      if(mid.length !== 8)
        throw new Error('MID must be length 8');
      db.put('id', mid, function(err, res){
        if(err) throw err;
        sema.leave();
      });

    });
  });

  db.mid = function(cb){
    if(mid)
      return cb(null, mid);
    sema.take(function(){
      cb(null, mid);
      sema.leave();
    });
  };
  return db;
};
