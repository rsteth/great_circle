"""Read/health-only rollout gate. Run under Great Circle's main-only OIDC role.
Never reads a secret, sends routing coordinates, or changes AWS resources.
"""
import base64, hashlib, json, os, pathlib, re, subprocess, tempfile
NAME = 'great-circle-api'
def aws(args, query=None):
    command = ['aws', *args, '--region', 'us-east-1', '--output', 'json']
    if query: command += ['--query', query]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        code = re.search(r'An error occurred \(([^)]+)\)', result.stderr)
        raise RuntimeError(args[0] + '/' + args[1] + ': ' + (code.group(1) if code else 'AwsCommandFailed'))
    return json.loads(result.stdout) if result.stdout.strip() else None
identity = aws(['sts', 'get-caller-identity'], '{Account:Account,Arn:Arn}')
assert identity['Account'] == '089089716476' and ':assumed-role/great-circle-prod-deploy/' in identity['Arn']
digest = base64.b64encode(hashlib.sha256(pathlib.Path('.lambda-build/great-circle-api.zip').read_bytes()).digest()).decode()
config = aws(['lambda', 'get-function-configuration', '--function-name', NAME, '--qualifier', 'prod'], '{CodeSha256:CodeSha256,Version:Version,Runtime:Runtime,Role:Role,Timeout:Timeout,Memory:MemorySize,Architectures:Architectures,State:State}')
assert config['CodeSha256'] == digest, 'Backend differs: deploy and verify backend before publishing this frontend'
assert config['State'] == 'Active' and config['Runtime'] == 'nodejs24.x' and config['Timeout'] == 30 and config['Memory'] == 512 and config['Architectures'] == ['arm64']
assert config['Role'] == 'arn:aws:iam::089089716476:role/great-circle-prod-runtime'
url = aws(['lambda', 'get-function-url-config', '--function-name', NAME, '--qualifier', 'prod'], '{FunctionUrl:FunctionUrl,AuthType:AuthType,InvokeMode:InvokeMode,Cors:Cors}')
expected = 'https://hhtrezedmjrsijdaxfcdj4au2q0mnjix.lambda-url.us-east-1.on.aws/'
assert url['FunctionUrl'] == expected and url['AuthType'] == 'NONE' and url['InvokeMode'] == 'BUFFERED'
cors = url['Cors']
assert cors['AllowOrigins'] == ['https://stethem.com'] and set(cors['AllowMethods']) == {'GET', 'POST'} and cors['AllowHeaders'] == ['content-type'] and not cors.get('AllowCredentials')
policy = json.loads(aws(['lambda', 'get-policy', '--function-name', NAME, '--qualifier', 'prod'])['Policy'])
statements = policy['Statement']
assert len(statements) == 2
for item in statements:
    assert item['Principal'] == '*' and item['Effect'] == 'Allow' and item['Resource'] == 'arn:aws:lambda:us-east-1:089089716476:function:great-circle-api:prod'
assert any(x['Action'] == 'lambda:InvokeFunctionUrl' and x['Condition'] == {'StringEquals': {'lambda:FunctionUrlAuthType': 'NONE'}} for x in statements)
assert any(x['Action'] == 'lambda:InvokeFunction' and x['Condition'] == {'Bool': {'lambda:InvokedViaFunctionUrl': 'true'}} for x in statements)
assert not aws(['lambda', 'get-function-concurrency', '--function-name', NAME])
# Private health is a single invocation with zero provider requests; no body/route logs.
with tempfile.TemporaryDirectory(prefix='great-circle-health-') as temp:
    payload = pathlib.Path(temp) / 'event.json'; output = pathlib.Path(temp) / 'response.json'
    payload.write_text(json.dumps({'version':'2.0','rawPath':'/api/health','headers':{},'requestContext':{'http':{'method':'GET'}}}))
    result = aws(['lambda','invoke','--function-name',NAME,'--qualifier','prod','--invocation-type','RequestResponse','--cli-binary-format','raw-in-base64-out','--payload','file://'+str(payload),'--log-type','None',str(output)],'{StatusCode:StatusCode,ExecutedVersion:ExecutedVersion,FunctionError:FunctionError}')
    health = json.loads(output.read_text())
    assert result.get('FunctionError') is None and result['ExecutedVersion'] == config['Version'] and health['statusCode'] == 200
    assert json.loads(health['body']) == {'ok':True,'provider':'openrouteservice','secret':'not-checked'}
print(json.dumps({'backendVerified':True,'version':config['Version'],'codeSha256':digest,'privateHealth':200,'routingRequests':0,'url':expected}))
