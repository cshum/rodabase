#Rodabase

Transactional, embedded document store for Node.js, built on [LevelDB](https://github.com/rvagg/node-levelup).

[![Build Status](https://travis-ci.org/cshum/rodabase.svg?branch=master)](https://travis-ci.org/cshum/rodabase)

##Introduction


##Basic Usage

```bash
$ npm install rodabase leveldown
```
<!-- [LevelDOWN](https://github.com/rvagg/node&#45;leveldown) is the default backing store for LevelDB.  -->

##API

####rodabase(path[, options])

```js
var rodabase = require('rodabase');

var roda = rodabase('./db');
```

###CRUD

####roda(name)

####roda.transaction()

```js

roda('count').put('bob', { n: 167 });

var tx = roda.transaction();
roda('count').get('bob', tx, function(err, data){
  data.n++;
  roda('count').put('bob', data, tx);

  tx.commit(function(){
    roda('count').get('bob', function(err, val){
      console.log(val.n); //equals 168
    });
  });
});
```

####.put([id], doc, [tx], [cb])

####.del(id, [cb])

####.read([options], [cb])

###Hooks
```js
roda('user').use('validate', function(ctx, next){
  if(!typeof ctx.result.name === 'string')
    return next(new Error('Name must be a string.'));

  ctx.result.name.toUpperCase();
  next();
});

roda('user').put({ name: 123 }, function(err, val){
  //Error: Name must be a string.
});
roda('user').put({ name: 'bob' }, function(err, val){
  console.log(val.name); //BOB
});
```

####.use('validate', [hook...])
####.use('diff', [hook...])

###Changes

####.changes([since], [limit], [cb])
####.clock([cb])

###Queue

####roda(name).queue(name)

```js
roda('user')
  .queue('email')
    .use('job', function(ctx, next){
      sendEmail(ctx.result.email, function(err){
        if(err) return next(err);

        //email sent
        next();
      });
    })
    .start();

roda('user').put({
  username: 'bob',
  email: 'bob@example.com'
}, function(err, data){
  //bob added. email comes afterwards.
});

```
####.use('job')
####.use('end')
####.use('error')
####.start()
####.stop()


###roda.db





##License

MIT
