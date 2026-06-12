import type { Context } from 'hono';
import type { Env } from './index';

const TRACKER_SCRIPT = `(function(){
  "use strict";
  var d=document,w=window,l=d.currentScript;
  if(!l)return;
  var sid=l.getAttribute("data-site-id");
  if(!sid)return;
  var endpoint=l.src.replace("/tracker.js","/collect");

  function send(data){
    try{
      var body=JSON.stringify(data);
      if(navigator.sendBeacon){
        navigator.sendBeacon(endpoint,body);
      }else{
        var xhr=new XMLHttpRequest();
        xhr.open("POST",endpoint,true);
        xhr.setRequestHeader("Content-Type","application/json");
        xhr.send(body);
      }
    }catch(e){}
  }

  function getUTM(k){
    try{
      return new URLSearchParams(w.location.search).get(k)||"";
    }catch(e){return "";}
  }

  function stripUrl(u){
    try{var p=new URL(u);return p.origin+p.pathname;}catch(e){return u.split("?")[0].split("#")[0];}
  }

  function stripRef(r){
    try{var h=new URL(r).hostname;return h===w.location.hostname?"":h;}catch(e){return "";}
  }

  function track(){
    send({
      sid:sid,
      url:stripUrl(w.location.href),
      ref:stripRef(d.referrer),
      sw:w.screen?w.screen.width:0,
      us:getUTM("utm_source"),
      um:getUTM("utm_medium")
    });
  }

  // Track on page load
  if(d.readyState==="complete"){
    track();
  }else{
    w.addEventListener("load",track,{once:true});
  }

  // Track SPA navigation via History API
  var pushState=history.pushState;
  history.pushState=function(){
    pushState.apply(this,arguments);
    setTimeout(track,10);
  };
  w.addEventListener("popstate",function(){setTimeout(track,10);});
})();`;

export function serveTracker(c: Context<{ Bindings: Env }>) {
  return c.newResponse(TRACKER_SCRIPT, 200, {
    'Content-Type': 'application/javascript',
    'Cache-Control': 'public, max-age=86400',
    'Access-Control-Allow-Origin': '*',
  });
}
