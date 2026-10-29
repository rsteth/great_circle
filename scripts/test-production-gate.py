"""Offline rollout guard tests; fake AWS only, no credentials or provider calls."""
import base64, contextlib, hashlib, io, json, os, pathlib, runpy, subprocess, sys, tempfile, unittest
from unittest.mock import patch
SCRIPT = pathlib.Path(__file__).with_name('verify-production-backend.py').resolve()
class GateTest(unittest.TestCase):
    def run_gate(self, *, same=False, deploy=False, unpublished=False, wrong_identity=False):
        calls = []; digest = base64.b64encode(hashlib.sha256(b'test-package').digest()).decode()
        state = {'alias':'1', 'latest':digest if same else 'old-package', 'prod':digest if same else 'old-package'}
        config = {'CodeSha256':state['prod'],'Version':'1','Runtime':'nodejs24.x','Role':'arn:aws:iam::089089716476:role/great-circle-prod-runtime','Timeout':30,'Memory':512,'Architectures':['arm64'],'State':'Active'}
        def fake(command, **_kwargs):
            action = command[1:3]; calls.append(action)
            if action == ['sts','get-caller-identity']: body={'Account':'other' if wrong_identity else '089089716476','Arn':'arn:aws:sts::089089716476:assumed-role/great-circle-prod-deploy/test'}
            elif action == ['lambda','get-function-configuration']:
                body={**config,'Version':state['alias'],'CodeSha256':state['prod']} if '--qualifier' in command else {**config,'CodeSha256':'unrelated-work' if unpublished else state['latest'],'RevisionId':'latest-revision','LastUpdateStatus':'Successful'}
            elif action == ['lambda','get-function-url-config']: body={'FunctionUrl':'https://hhtrezedmjrsijdaxfcdj4au2q0mnjix.lambda-url.us-east-1.on.aws/','AuthType':'NONE','InvokeMode':'BUFFERED','Cors':{'AllowOrigins':['https://stethem.com'],'AllowMethods':['GET','POST'],'AllowHeaders':['content-type'],'AllowCredentials':False}}
            elif action == ['lambda','get-policy']: body={'Policy':json.dumps({'Statement':[{'Principal':'*','Effect':'Allow','Resource':'arn:aws:lambda:us-east-1:089089716476:function:great-circle-api:prod','Action':a,'Condition':c}for a,c in [('lambda:InvokeFunctionUrl',{'StringEquals':{'lambda:FunctionUrlAuthType':'NONE'}}),('lambda:InvokeFunction',{'Bool':{'lambda:InvokedViaFunctionUrl':'true'}})]]})}
            elif action == ['lambda','get-function-concurrency']: body={}
            elif action == ['lambda','get-alias']: body={'FunctionVersion':'1','RevisionId':'alias-revision'}
            elif action == ['lambda','update-function-code']:
                self.assertEqual(command[command.index('--revision-id')+1],'latest-revision');state['latest']=digest;body={'CodeSha256':digest}
            elif action == ['lambda','wait']: body=None
            elif action == ['lambda','publish-version']: body={'Version':'2','CodeSha256':digest}
            elif action == ['lambda','update-alias']:
                self.assertEqual(command[command.index('--revision-id')+1],'alias-revision');state.update(alias='2',prod=digest);body={'FunctionVersion':'2'}
            elif action == ['lambda','invoke']:
                # Locate the response file directly before appended global options.
                output=pathlib.Path(command[command.index('--region')-1]);output.write_text(json.dumps({'statusCode':200,'body':json.dumps({'ok':True,'provider':'openrouteservice','secret':'not-checked'})}));body={'ExecutedVersion':state['alias'],'StatusCode':200}
            else: raise AssertionError('Unexpected AWS operation '+repr(action))
            return subprocess.CompletedProcess(command,0,'' if body is None else json.dumps(body),'')
        with tempfile.TemporaryDirectory() as temporary:
            previous=os.getcwd();os.chdir(temporary)
            try:
                pathlib.Path('.lambda-build').mkdir();pathlib.Path('.lambda-build/great-circle-api.zip').write_bytes(b'test-package')
                with patch('subprocess.run',fake),patch.object(sys,'argv',[str(SCRIPT)]+(['--deploy-matching']if deploy else [])),patch.dict(os.environ,{'GITHUB_SHA':'a'*40}),contextlib.redirect_stdout(io.StringIO()):
                    runpy.run_path(str(SCRIPT),run_name='__main__')
            finally:os.chdir(previous)
        return calls
    def test_matching_version_is_read_health_only(self):
        calls=self.run_gate(same=True);self.assertIn(['lambda','invoke'],calls);self.assertFalse(any(x[1]in['update-function-code','publish-version','update-alias']for x in calls))
    def test_new_code_requires_explicit_deploy_flag(self):
        with self.assertRaisesRegex(AssertionError,'explicitly deploy'):self.run_gate()
    def test_deployment_precedes_private_health_and_uses_only_code_version_alias_writes(self):
        calls=self.run_gate(deploy=True);writes=[x[1]for x in calls if x[1]in['update-function-code','publish-version','update-alias']];self.assertEqual(writes,['update-function-code','publish-version','update-alias']);self.assertLess(calls.index(['lambda','update-alias']),calls.index(['lambda','invoke']))
    def test_unrelated_unpublished_work_is_preserved(self):
        with self.assertRaisesRegex(AssertionError,'unrelated unpublished'):self.run_gate(deploy=True,unpublished=True)
    def test_wrong_account_stops_before_mutation(self):
        with self.assertRaises(AssertionError):self.run_gate(deploy=True,wrong_identity=True)
if __name__=='__main__':unittest.main()
