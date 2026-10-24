"""Create an independent LAN development CA. Never install trust automatically."""
import argparse
import datetime as dt
import ipaddress
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID

parser = argparse.ArgumentParser()
parser.add_argument('address')
parser.add_argument('--output', default=str(Path(__file__).resolve().parents[1] / '.certs'))
args = parser.parse_args()
address = ipaddress.ip_address(args.address)
folder = Path(args.output).resolve()
folder.mkdir(parents=True, exist_ok=True)
now = dt.datetime.now(dt.timezone.utc)
key_path = folder / 'ca-key.pem'
cert_path = folder / 'ca.pem'
if key_path.exists() != cert_path.exists():
    raise ValueError('Incomplete local CA: keep ca-key.pem and ca.pem together; choose a new output directory to create another CA.')
if key_path.exists() and cert_path.exists():
    ca_key = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
    ca = x509.load_pem_x509_certificate(cert_path.read_bytes())
else:
    ca_key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Beizhi Liveness Lab Local Test CA')])
    ca = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
          .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
          .not_valid_before(now - dt.timedelta(minutes=5)).not_valid_after(now + dt.timedelta(days=365))
          .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
          .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False, key_encipherment=False,
                                     data_encipherment=False, key_agreement=False, key_cert_sign=True,
                                     crl_sign=True, encipher_only=False, decipher_only=False), critical=True)
          .sign(ca_key, hashes.SHA256()))
    key_path.write_bytes(ca_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    cert_path.write_bytes(ca.public_bytes(serialization.Encoding.PEM))
server_key = ec.generate_private_key(ec.SECP256R1())
server_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, str(address))])
server = (x509.CertificateBuilder().subject_name(server_name).issuer_name(ca.subject)
          .public_key(server_key.public_key()).serial_number(x509.random_serial_number())
          .not_valid_before(now - dt.timedelta(minutes=5)).not_valid_after(now + dt.timedelta(days=30))
          .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
          .add_extension(x509.SubjectAlternativeName([x509.IPAddress(address), x509.DNSName('localhost'), x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), critical=False)
          .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
          .sign(ca_key, hashes.SHA256()))
(folder / 'server-key.pem').write_bytes(server_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
(folder / 'server.pem').write_bytes(server.public_bytes(serialization.Encoding.PEM))
(folder / 'ca.cer').write_bytes(ca.public_bytes(serialization.Encoding.DER))
for private_key in [key_path, folder / 'server-key.pem']:
    private_key.chmod(0o600)
print(f'Local test certificate ready for {address}. Trust installation remains manual.')
