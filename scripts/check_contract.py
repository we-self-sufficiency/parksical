"""Validate S-01 documentation schemas/examples; does not test a running API."""
import copy
import json
import re
from decimal import Decimal
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
DOC = json.loads((ROOT / 'docs/openapi.json').read_text(), parse_float=Decimal)
MANIFEST = json.loads((ROOT / 'docs/examples/manifest.json').read_text(), parse_float=Decimal)


def load_example(name):
    # Preserve decimal precision: 11.7 is a valid multiple of 0.001 in the transport contract.
    return json.loads((ROOT / 'docs/examples' / name).read_text(), parse_float=Decimal)


def validator(name):
    return Draft202012Validator(
        {'$ref': '#/components/schemas/' + name, 'components': DOC['components']},
        format_checker=FormatChecker(),
    )


def resolve(value):
    if '$ref' not in value:
        return value
    target = DOC
    for part in value['$ref'][2:].split('/'):
        target = target[part]
    return target


def check_refs(value):
    if isinstance(value, dict):
        if '$ref' in value:
            assert value['$ref'].startswith('#/'), 'External refs require explicit support'
            target = DOC
            for part in value['$ref'][2:].split('/'):
                target = target[part.replace('~1', '/').replace('~0', '~')]
        for child in value.values():
            check_refs(child)
    elif isinstance(value, list):
        for child in value:
            check_refs(child)


assert DOC['openapi'] == '3.1.1'
assert DOC['servers'][0]['url'].endswith('/api/v1')
assert DOC['security'] == [{'bearerAuth': []}]
check_refs(DOC)
operations = {}
for path, methods in DOC['paths'].items():
    for method, operation in methods.items():
        oid = operation['operationId']
        assert oid not in operations, f'Duplicate operationId: {oid}'
        operations[oid] = operation
        path_params = {p['name'] for p in operation.get('parameters', []) if p['in'] == 'path'}
        assert path_params == set(re.findall(r'\{([^}]+)\}', path)), path
        assert all(p['required'] for p in operation.get('parameters', []) if p['in'] == 'path')
        assert {'400', '401', '403', '404', '409', '413', '422', '429', '503'} <= set(operation['responses'])
        if method in ('post', 'patch', 'put'):
            if operation.get('x-idempotency-policy') == 'credential-flow':
                assert path.startswith('/auth/'), 'Credential exception must be scoped to authentication'
            else:
                assert any(p['name'] == 'Idempotency-Key' and p['required'] for p in operation['parameters'])
        if method != 'get':
            if not operation.get('security', DOC['security']):
                assert oid in {'refreshAuthentication', 'startVehicleLink', 'exchangeVehicleLink'}, 'Unapproved public write'
        for status, response in operation['responses'].items():
            response = resolve(response)
            if status == '204':
                assert 'content' not in response
            elif int(status) >= 400:
                assert response['content']['application/json']['schema']['$ref'].endswith('/Error')

for name, schema in DOC['components']['schemas'].items():
    Draft202012Validator.check_schema(schema)
for filename, name in MANIFEST['schemas'].items():
    validator(name).validate(load_example(filename))
for case in MANIFEST['cases']:
    operation = operations[case['operationId']]
    if 'requestExample' in case:
        request_schema = operation['requestBody']['content']['application/json']['schema']['$ref'].split('/')[-1]
        validator(request_schema).validate(load_example(case['requestExample']))
    response = resolve(operation['responses'][str(case['status'])])['content']['application/json']['schema']
    assert response['$ref'].endswith('/' + case['schema']), case['name']
    validator(case['schema']).validate(load_example(case['example']))
for operation in operations.values():
    media = operation.get('requestBody', {}).get('content', {}).get('application/json', {})
    if 'example' in media:
        validator(media['schema']['$ref'].split('/')[-1]).validate(media['example'])
    for response in operation['responses'].values():
        response = resolve(response)
        media = response.get('content', {}).get('application/json', {})
        if 'example' in media:
            validator(media['schema']['$ref'].split('/')[-1]).validate(media['example'])
for case in MANIFEST['negativeCases']:
    invalid = copy.deepcopy(load_example(case['baseExample']))
    invalid.update(case.get('set', {}))
    # Nested mutations avoid duplicating the entire layout fixture for one invalid field.
    for path, value in case.get('setPaths', {}).items():
        parts = path.split('.')
        target = invalid
        for part in parts[:-1]:
            target = target[int(part) if isinstance(target, list) else part]
        target[int(parts[-1]) if isinstance(target, list) else parts[-1]] = value
    assert list(validator(case['schema']).iter_errors(invalid)), case['reason']

contract = (ROOT / 'docs/api-contract.md').read_text()
decisions = (ROOT / 'docs/DECISIONS.md').read_text()
for i in range(1, 8):
    assert f'D-{i:02}' in decisions
for filename in ['openapi.json', 'DECISIONS.md', 'vehicle-contract-notes.md']:
    assert filename in contract
assert 'rawSignals' not in DOC['components']['schemas']['SessionCreate']['properties']
print(f'PASS: {len(operations)} operations, {len(DOC["components"]["schemas"])} schemas, '
      f'{len(MANIFEST["schemas"])} examples, {len(MANIFEST["cases"])} response cases, '
      f'{len(MANIFEST["negativeCases"])} rejected inputs; refs/parameters/security/decisions checked.')
