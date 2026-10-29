"""Backend-first rollout gate under Great Circle's main-only OIDC role.
Read/health-only by default. --deploy-matching explicitly permits code/version/
prod-alias updates only; never changes configuration, IAM, URLs or secrets.
"""
import argparse, base64, hashlib, json, os, pathlib, re, subprocess, tempfile
parser = argparse.ArgumentParser()
parser.add_argument('--deploy-matching', action='store_true')
options = parser.parse_args()
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
# All resource/configuration checks above happen before code-only mutations.
if config['CodeSha256'] != digest:
    assert options.deploy_matching, 'Backend differs: explicitly deploy matching backend before frontend'
    source = os.environ.get('GITHUB_SHA', '')
    assert re.fullmatch('[0-9a-f]{40}', source), 'Expected exact approved source SHA'
    alias = aws(['lambda','get-alias','--function-name',NAME,'--name','prod'])
    assert alias['FunctionVersion'] == config['Version'] and not alias.get('RoutingConfig', {}).get('AdditionalVersionWeights'), 'Unexpected alias changes'
    fields = '{CodeSha256:CodeSha256,RevisionId:RevisionId,Role:Role,Runtime:Runtime,Timeout:Timeout,Memory:MemorySize,Architectures:Architectures,State:State,LastUpdateStatus:LastUpdateStatus}'
    latest = aws(['lambda','get-function-configuration','--function-name',NAME], fields)
    for field in ['Role','Runtime','Timeout','Memory','Architectures','State']:
        assert latest[field] == config[field], 'Unexpected unpublished configuration'
    assert latest['LastUpdateStatus'] == 'Successful'
    assert latest['CodeSha256'] in [config['CodeSha256'], digest], 'Preserve unrelated unpublished Lambda code'
    if latest['CodeSha256'] != digest:
        updated = aws(['lambda','update-function-code','--function-name',NAME,'--zip-file','fileb://.lambda-build/great-circle-api.zip','--revision-id',latest['RevisionId']], '{CodeSha256:CodeSha256}')
        assert updated['CodeSha256'] == digest
        aws(['lambda','wait','function-updated-v2','--function-name',NAME])
        latest = aws(['lambda','get-function-configuration','--function-name',NAME], fields)
    assert latest['CodeSha256'] == digest and latest['LastUpdateStatus'] == 'Successful'
    for field in ['Role','Runtime','Timeout','Memory','Architectures','State']:
        assert latest[field] == config[field], 'Concurrent configuration change; preserve it before publication'
    version = aws(['lambda','publish-version','--function-name',NAME,'--code-sha256',digest,'--revision-id',latest['RevisionId'],'--description','Approved Great Circle source '+source], '{Version:Version,CodeSha256:CodeSha256}')
    assert version['CodeSha256'] == digest and version['Version'].isdigit()
    aws(['lambda','update-alias','--function-name',NAME,'--name','prod','--function-version',version['Version'],'--revision-id',alias['RevisionId']], '{FunctionVersion:FunctionVersion}')
    deployed = aws(['lambda','get-function-configuration','--function-name',NAME,'--qualifier','prod'], '{CodeSha256:CodeSha256,Version:Version,Runtime:Runtime,Role:Role,Timeout:Timeout,Memory:MemorySize,Architectures:Architectures,State:State}')
    assert deployed['Version'] == version['Version']
    for field in ['Role','Runtime','Timeout','Memory','Architectures','State']:
        assert deployed[field] == config[field]
    config = deployed
    print(json.dumps({'backendDeployed':True,'version':config['Version'],'source':source,'codeSha256':digest}))
assert config['CodeSha256'] == digest
# Private health is a single invocation with zero provider requests; no body/route logs.
with tempfile.TemporaryDirectory(prefix='great-circle-health-') as temp:
    payload = pathlib.Path(temp) / 'event.json'; output = pathlib.Path(temp) / 'response.json'
    payload.write_text(json.dumps({'version':'2.0','rawPath':'/api/health','headers':{},'requestContext':{'http':{'method':'GET'}}}))
    result = aws(['lambda','invoke','--function-name',NAME,'--qualifier','prod','--invocation-type','RequestResponse','--cli-binary-format','raw-in-base64-out','--payload','file://'+str(payload),'--log-type','None',str(output)],'{StatusCode:StatusCode,ExecutedVersion:ExecutedVersion,FunctionError:FunctionError}')
    health = json.loads(output.read_text())
    assert result.get('FunctionError') is None and result['ExecutedVersion'] == config['Version'] and health['statusCode'] == 200
    assert json.loads(health['body']) == {'ok':True,'provider':'openrouteservice','secret':'not-checked'}
print(json.dumps({'backendVerified':True,'version':config['Version'],'codeSha256':digest,'privateHealth':200,'routingRequests':0,'url':expected}))
