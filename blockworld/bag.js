export const STACK_LIMIT=100,BAG_SLOTS=Infinity,HOTBAR_SLOTS=6;
const itemCount=value=>Number.isFinite(Number(value))?Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Math.floor(Number(value)))):0;
const storedCount=(id,value,hotbar)=>Math.max(0,itemCount(value)-(hotbar.includes(id)?STACK_LIMIT:0));
export function bagSlotCount(inventory,hotbar,tools=[]){return tools.length+Object.entries(inventory).reduce((n,[id,value])=>n+Math.ceil(storedCount(id,value,hotbar)/STACK_LIMIT),0);}
export function bagLayout(inventory,hotbar,tools=[],{offset=0,limit=Infinity}={}){
  const slots=[];let cursor=0;
  for(const id of tools){if(cursor++>=offset&&slots.length<limit)slots.push({id,count:1,tool:true});}
  for(const [id,value] of Object.entries(inventory)){
    const count=storedCount(id,value,hotbar),stacks=Math.ceil(count/STACK_LIMIT),start=Math.max(0,offset-cursor),end=Math.min(stacks,start+Math.max(0,limit-slots.length));
    for(let i=start;i<end;i++)slots.push({id,count:Math.min(STACK_LIMIT,count-i*STACK_LIMIT)});
    cursor+=stacks;if(slots.length>=limit)break;
  }
  return slots;
}
export function canCollect(inventory,hotbar,id,tools=[]){return itemCount(inventory[id])<Number.MAX_SAFE_INTEGER;}
export function nextMorning(seconds){return (Math.floor(seconds/86400)+(seconds%86400>=18*3600?1:0))*86400+8*3600;}
