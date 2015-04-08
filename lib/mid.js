var semaphore = require('./util').semaphore,
    crypto    = require('crypto');

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

      crypto.randomBytes(6, function(err, buf){
        if(err)
          throw err;

        mid = buf.toString('base64')
          .replace(/\//g,'_')
          .replace(/\+/g,'-');

        db.put('id', mid, function(err, res){
          if(err)
            throw err;
          sema.leave();
        });
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
