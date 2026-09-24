import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('SMB verifier exits zero after authenticated encrypted session and rejects failures without output', () => {
  const code = `import runpy,sys,types
conn=types.ModuleType('smbprotocol.connection');ses=types.ModuleType('smbprotocol.session')
class Connection:
 def __init__(self,*a,**k): assert k['require_signing'] is True
 def connect(self,**k): assert k['dialect']==785
 def disconnect(self): pass
class Session:
 def __init__(self,*a,**k):
  assert k['require_encryption'] is True
  self.session_key=b'fixture'; self.encrypt_data=True
 def connect(self):
  if sys.argv[1]=='fail': raise ValueError('private password')
 def disconnect(self): pass
conn.Connection=Connection;conn.Dialects=types.SimpleNamespace(SMB_3_1_1=785);ses.Session=Session
sys.modules['smbprotocol']=types.ModuleType('smbprotocol');sys.modules['smbprotocol.connection']=conn;sys.modules['smbprotocol.session']=ses
runpy.run_path('scripts/verify_smb.py',run_name='__main__')`;
  for (const mode of ['ok', 'fail']) {
    const result = spawnSync('python3', ['-c', code, mode], {
      input: JSON.stringify({
        host: 'nas.example.com',
        username: 'alice',
        password: 'private password',
      }),
      encoding: 'utf8',
    });
    assert.equal(result.status, mode === 'ok' ? 0 : 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
});
