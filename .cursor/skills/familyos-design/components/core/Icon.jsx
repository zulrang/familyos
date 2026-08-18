import React from 'react';
const CDN='https://unpkg.com/lucide-static@0.544.0/icons/';
export function Icon({name,size=20,strokeColor='currentColor',style,...rest}){
  return <span aria-hidden="true" {...rest} style={{display:'inline-block',width:size,height:size,flex:'0 0 auto',backgroundColor:strokeColor,WebkitMaskImage:`url(${CDN}${name}.svg)`,maskImage:`url(${CDN}${name}.svg)`,WebkitMaskRepeat:'no-repeat',maskRepeat:'no-repeat',WebkitMaskPosition:'center',maskPosition:'center',WebkitMaskSize:'contain',maskSize:'contain',...style}}/>;
}
