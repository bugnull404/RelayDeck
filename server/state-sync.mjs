import { createHash } from 'node:crypto';
export class SnapshotDigests {
  constructor(limit=20000){this.limit=limit;this.entries=new Map();}
  digest(threadId,revision,turn){
    const identity=typeof revision==='number'?`${threadId}:${turn.id}:${revision}`:`${threadId}:${turn.id}`;
    const prior=this.entries.get(identity);
    if(prior)return prior;
    const value=createHash('sha256').update(JSON.stringify(turn)).digest('hex');
    this.entries.set(identity,value);
    if(this.entries.size>this.limit)for(const key of this.entries.keys()){this.entries.delete(key);if(this.entries.size<=Math.floor(this.limit*.8))break;}
    return value;
  }
  retain(keys){for(const key of [...this.entries.keys()])if(!keys.has(key))this.entries.delete(key);}
}
export function prioritizeThreads(threads,selectedId){
  const id=selectedId||threads[0]?.id;return [...threads].sort((a,b)=>(b.id===id?1:0)-(a.id===id?1:0)).map(thread=>thread.id===id?{...thread,metadataOnly:false}:{...thread,metadataOnly:true,turns:(thread.turns||[]).slice(-1).map(({id,status,startedAtMs,failureReason})=>({id,status,startedAtMs,failureReason}))});
}

// Enforce one byte budget over an already-projected mobile snapshot. The
// selected chat keeps its newest turns; other chats degrade to metadata first.
export function boundThreads(threads,budget=6*1024*1024){
  let total=0;
  const selected=threads.find(row=>row.metadataOnly===false)||threads[0];
  const ordered=[...(selected?[selected]:[]),...threads.filter(row=>row!==selected)];
  const result=[];
  let reduced=false;
  for(const source of ordered){
    const row={...source};
    let turns=[...(row.turns||[])];
    let bytes=Buffer.byteLength(JSON.stringify({...row,turns}));
    if(total+bytes>budget){
      // Drop turns oldest-first; always retain the latest one for status.
      while(turns.length>1&&total+bytes>budget){turns.shift();bytes=Buffer.byteLength(JSON.stringify({...row,turns}));reduced=true;}
      if(turns.length===1&&total+bytes>budget&&row.id!==selected.id){row.turns=[];row.truncated=true;bytes=Buffer.byteLength(JSON.stringify(row));reduced=true;}
      if(total+bytes>budget)throw Object.assign(Error('移动端状态超过体积上限'),{status:413});
    }
    row.turns=turns;
    if(row.id===selected.id&&source.turnOrder)row.turnOrder=source.turnOrder.filter(id=>turns.some(turn=>turn.id===id));
    total+=bytes;result.push(row);
  }
  if(reduced&&result.length)result[0]={...result[0],truncated:true,truncationReason:'mobile snapshot bounded'};
  return result;
}

// Keep only digests per authorized session, never copies of chat bodies.
export function mobileStateWindow(threads, previous, version, after, digests = new SnapshotDigests()) {
  const delta = !!previous && String(previous.version) === after;
  const signatures = new Map();
  const rows = threads.map(thread => {
    const turns = [];
    for (const turn of thread.turns || []) {
      const key = JSON.stringify([thread.id, turn.id]);
      const digest = digests.digest(thread.id,thread.revision,turn);
      signatures.set(key, digest);
      if (!delta || previous.signatures.get(key) !== digest) turns.push(turn);
    }
    return { ...thread, turns, ...thread.metadataOnly?{}:{turnOrder: (thread.turns || []).map(turn => turn.id)} };
  });
  digests.retain(new Set(signatures.keys()));
  return { payload: { sync: delta ? 'delta' : 'full', ...(delta ? { baseVersion: previous.version } : {}), threads: rows }, baseline: { version, signatures } };
}
