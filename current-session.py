"""Read only native session metadata. Never run/resume a model or guess by recency."""
import sys,json,pathlib,sqlite3,re

def config_home(pid,key,default):
    for item in pathlib.Path('/proc',str(pid),'environ').read_bytes().split(b'\0'):
        k,_,v=item.partition(b'=')
        if k.decode(errors='replace')==key and v:
            return pathlib.Path(v.decode())
    return pathlib.Path.home()/default

def select_codex(rows,paths,title,cwd):
    # The TUI sets its title from the selected thread. Do not pick the newest
    # thread or the daemon's newest file: either could be a different client.
    # Codex's default title is activity + thread-name + project-name.
    # Activity changes every 100 ms while working, and also on approval prompts.
    # Keep both literal and normalized labels so a genuinely similarly named
    # thread creates an ambiguity rather than silently selecting the wrong one.
    original=title.strip()
    normalized=re.sub(r'^(?:●\s*)?(?:[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*(?:\|\s*)?|\[ [!.] \] Action Required\s*(?:\|\s*)?|●\s*)','',original)
    labels={s for value in (original,normalized) for s in (value,value.rsplit(' | ',1)[0].strip()) if s}
    def matches(value):
        if not value:return False
        value=' '.join(value.split())
        # Native titles truncate long thread names to 48 grapheme clusters.
        # Prefix matching is only permitted for an explicit long ellipsis;
        # all collisions still fail closed below.
        return any(label==value or (label.endswith('...') and len(label)>=40 and value.startswith(label[:-3])) for label in labels)
    matched=[r for r in rows if r['cwd']==cwd and any(matches(r[k]) for k in ('name','title'))]
    if len(matched)==1: return matched[0]
    if len(matched)>1: raise ValueError('The Codex title matches multiple sessions. Give the native conversation a unique name.')
    label=normalized.rsplit(' | ',1)[0].strip()
    generic=not label or label.lower() in ('codex','codex cli',pathlib.Path(cwd).name.lower())
    # The daemon may retain a file from before /new. A generic title is never
    # evidence that its sole open file is the currently selected conversation.
    if generic:return None  # Fresh TUI: wait for its selected thread title.
    raise ValueError('Waiting for an unambiguous Codex session identity. No input is being sent.')

def resolve(t):
    pid=t['pid']; cwd=t['cwd']
    if t['agent']=='claude':
        base=config_home(pid,'CLAUDE_CONFIG_DIR','.claude')
        data=json.loads((base/'sessions'/f'{pid}.json').read_text())
        if data.get('pid')!=pid or str(data.get('procStart'))!=t['start']:
            raise ValueError('Claude is changing processes. Waiting for current session metadata.')
        sid=data['sessionId']
        if not re.fullmatch(r'[a-fA-F0-9-]{36}',sid): raise ValueError('Invalid session identifier.')
        paths=list((base/'projects').glob('*/'+sid+'.jsonl'))
        if len(paths)>1: raise ValueError('Multiple Claude transcripts match. No input is being sent.')
        if not paths:
            project=re.sub(r'[^a-zA-Z0-9]','-',data.get('cwd') or cwd)
            paths=[base/'projects'/project/(sid+'.jsonl')]
        return {'id':sid,'log':str(paths[0]),'title':t['title'].lstrip('✳✻✽✶✢· ').strip() or data.get('name') or 'New Claude conversation','agent':'claude'}
    base=config_home(pid,'CODEX_HOME','.codex')
    rows=[]
    if (base/'state_5.sqlite').exists():
        con=sqlite3.connect((base/'state_5.sqlite').as_uri()+'?mode=ro',uri=True,timeout=2)
        con.row_factory=sqlite3.Row
        # Only metadata is read; no prompts, credentials, or model requests.
        rows=[dict(r) for r in con.execute('select id,name,title,cwd,source,rollout_path from threads where cwd=?',(cwd,))]
        con.close()
    row=select_codex(rows,set(),t['title'],cwd)
    if row is None:return {'id':None,'log':None,'title':'New Codex conversation (waiting for first message)','agent':'codex','pending':True}
    return {'id':row['id'],'log':row['rollout_path'],'title':row['name'] or row['title'][:100] or 'Codex','agent':'codex'}

if __name__=='__main__':
    try: print(json.dumps(resolve(json.load(sys.stdin)),ensure_ascii=False))
    except Exception as e:
        # Do not dump process environment or database contents on failure.
        print(json.dumps({'error':str(e)},ensure_ascii=False));sys.exit(0)
