'use strict';
// Retired UI is exercised only by tests, never by the production server.
const fs=require('node:fs'),path=require('node:path');
const service=require('../server/research-service.cjs');
function createServer(options){const server=service.createServer(options),listeners=server.listeners('request');server.removeAllListeners('request');server.on('request',(req,res)=>{if(new URL(req.url,'http://localhost').pathname==='/research-collection.html'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fs.readFileSync(path.join(__dirname,'fixtures/research-collection.html')));return;}for(const listener of listeners)listener.call(server,req,res);});return server;}
module.exports={...service,createServer};
