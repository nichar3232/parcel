import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,chmod} from 'node:fs/promises';
const state=process.env.STRATA_STATE_DIR||'/var/lib/stocklana';
const dir=`${state}/backups`;
await mkdir(dir,{recursive:true,mode:0o700});
const db=new DatabaseSync(`${state}/strata.sqlite`,{readOnly:true});
try{const file=`${dir}/strata-${new Date().toISOString().replaceAll(':','-')}.sqlite`;await backup(db,file);await chmod(file,0o600);console.log(`Consistent SQLite backup: ${file}`);}finally{db.close();}
