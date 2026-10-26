from pathlib import Path
p=Path('pulse-application-identity.mjs')
s=p.read_text(encoding='utf-8')
if "route('directory'" not in s:
 imports="""import {loadHrDirectory} from './hr-directory-bridge.mjs';
import {CDIR_MASTER_NAMES,cdirDirectoryFromMasters} from './cdir-masters.mjs';
import {cdirViewerContext,cdirDirectoryForViewer} from './cdir-access.mjs';
import {mergeCdirReportingSuperiors} from './cdir-organisation.mjs';
"""
 a=s.index("  route('validate',");b=s.index("  route('logout',",a)
 route=s[a:b].replace("  route('validate',", "  if(application==='HR')route('directory',")
 route=route.replace('   res.json({profile});',"   res.json(await loadHrDirectory({pool,profile,user:row.record_data,masterNames:CDIR_MASTER_NAMES,buildDirectory:cdirDirectoryFromMasters,mergeSuperiors:mergeCdirReportingSuperiors,viewerContext:cdirViewerContext,forViewer:cdirDirectoryForViewer}));")
 p.write_text(imports+s[:b]+route+s[b:],encoding='utf-8')
