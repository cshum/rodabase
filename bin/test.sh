#!/bin/bash
set -e 

rm -rf test/db 
for t in test/*.js
do 
  node $t
done
