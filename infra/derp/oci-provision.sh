#!/usr/bin/env bash
# Garena.mn — Oracle Cloud Always Free ARM сервер (DERP relay) үүсгэх: VCN + IGW + route + subnet + security list + instance.
# Хэрэглээ (Git Bash, ~/.oci/config бэлэн):  bash oci-provision.sh
# Idempotent: display-name-ээр байгаа нөөцийг дахин ашиглана. "Out of host capacity" бол дахин ажиллуулна (Oracle SG-д цөөн минут-цагийн дараа гардаг).
set -euo pipefail
OCI="${OCI:-$LOCALAPPDATA/Programs/Python/Python311/Scripts/oci.exe}"
export SUPPRESS_LABEL_WARNING=True
T="${OCI_TENANCY:-ocid1.tenancy.oc1..aaaaaaaaa6vstelb32r6u5hb2lek2725nb7mjy755hyfubjy3ykonxohlxiq}"
NAME="${NAME:-garena-derp1}"; OCPUS="${OCPUS:-2}"; MEM="${MEM:-12}"
SSH_PUB="${SSH_PUB:-$HOME/.ssh/garena_oci.pub}"
q() { "$OCI" "$@" --output json; }
id_of() { python -c "import sys,json; d=json.load(sys.stdin); d=d.get('data',d); print((d[0] if isinstance(d,list) else d)['id'])"; }

AD=$(q iam availability-domain list -c "$T" | python -c "import sys,json; print(json.load(sys.stdin)['data'][0]['name'])")
echo "AD=$AD"
# --- VCN ---
VCN=$(q network vcn list -c "$T" --display-name garena-vcn | python -c "import sys,json; d=json.load(sys.stdin).get('data',[]); print(d[0]['id'] if d else '')")
[ -n "$VCN" ] || VCN=$(q network vcn create -c "$T" --display-name garena-vcn --cidr-block 10.0.0.0/16 --dns-label garena --wait-for-state AVAILABLE | id_of)
echo "VCN=$VCN"
IGW=$(q network internet-gateway list -c "$T" --vcn-id "$VCN" | python -c "import sys,json; d=json.load(sys.stdin).get('data',[]); print(d[0]['id'] if d else '')")
[ -n "$IGW" ] || IGW=$(q network internet-gateway create -c "$T" --vcn-id "$VCN" --is-enabled true --display-name garena-igw --wait-for-state AVAILABLE | id_of)
RT=$(q network vcn get --vcn-id "$VCN" | python -c "import sys,json; print(json.load(sys.stdin)['data']['default-route-table-id'])")
q network route-table update --rt-id "$RT" --force --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" >/dev/null
SL=$(q network vcn get --vcn-id "$VCN" | python -c "import sys,json; print(json.load(sys.stdin)['data']['default-security-list-id'])")
# Ingress: SSH 22, HTTP 80, HTTPS 443 (DERP), 7000 (relay) TCP; 3478 UDP (STUN); ICMP
q network security-list update --security-list-id "$SL" --force --egress-security-rules '[{"destination":"0.0.0.0/0","protocol":"all","isStateless":false}]' --ingress-security-rules '[
 {"source":"0.0.0.0/0","protocol":"6","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},
 {"source":"0.0.0.0/0","protocol":"6","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},
 {"source":"0.0.0.0/0","protocol":"6","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":443,"max":443}}},
 {"source":"0.0.0.0/0","protocol":"6","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":7000,"max":7000}}},
 {"source":"0.0.0.0/0","protocol":"17","isStateless":false,"udpOptions":{"destinationPortRange":{"min":3478,"max":3478}}},
 {"source":"0.0.0.0/0","protocol":"17","isStateless":false,"udpOptions":{"destinationPortRange":{"min":41641,"max":41641}}},
 {"source":"0.0.0.0/0","protocol":"1","isStateless":false}]' >/dev/null
SUB=$(q network subnet list -c "$T" --vcn-id "$VCN" --display-name garena-public | python -c "import sys,json; d=json.load(sys.stdin).get('data',[]); print(d[0]['id'] if d else '')")
[ -n "$SUB" ] || SUB=$(q network subnet create -c "$T" --vcn-id "$VCN" --cidr-block 10.0.0.0/24 --display-name garena-public --dns-label pub --route-table-id "$RT" --security-list-ids "[\"$SL\"]" --wait-for-state AVAILABLE | id_of)
echo "SUBNET=$SUB"
# --- Image (Ubuntu 24.04 aarch64) ---
IMG=$(q compute image list -c "$T" --operating-system "Canonical Ubuntu" --operating-system-version "24.04" --shape VM.Standard.A1.Flex --sort-by TIMECREATED | python -c "import sys,json; print(json.load(sys.stdin)['data'][0]['id'])")
echo "IMAGE=$IMG"
# --- Instance ---
INST=$(q compute instance list -c "$T" --display-name "$NAME" --lifecycle-state RUNNING | python -c "import sys,json; d=json.load(sys.stdin).get('data',[]); print(d[0]['id'] if d else '')")
if [ -z "$INST" ]; then
  INST=$(q compute instance launch -c "$T" --availability-domain "$AD" --display-name "$NAME" --shape VM.Standard.A1.Flex \
    --shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEM}" --image-id "$IMG" --subnet-id "$SUB" --assign-public-ip true \
    --ssh-authorized-keys-file "$SSH_PUB" --wait-for-state RUNNING --max-wait-seconds 600 | id_of)
fi
echo "INSTANCE=$INST"
IP=$(q compute instance list-vnics --instance-id "$INST" | python -c "import sys,json; print(json.load(sys.stdin)['data'][0]['public-ip'])")
echo "PUBLIC_IP=$IP"
