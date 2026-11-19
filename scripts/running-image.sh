#!/usr/bin/env bash
set -euo pipefail
container=${1:?container required}
repository=${2:?image repository required}
[[ $container =~ ^[a-z0-9-]+$ && $repository =~ ^[a-z0-9./-]+$ ]]
[[ $OCI_HOST =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ && $OCI_USER =~ ^[a-z_][a-z0-9_-]*$ ]]
umask 077
dir=$(mktemp -d)
trap 'rm -rf -- "$dir"' EXIT
printf '%s\n' "$OCI_SSH_KEY" > "$dir/key"
printf '%s\n' "$OCI_KNOWN_HOSTS" > "$dir/hosts"
ssh -F /dev/null -i "$dir/key" -o IdentitiesOnly=yes -o BatchMode=yes \
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$dir/hosts" -o ConnectTimeout=15 \
    "$OCI_USER@$OCI_HOST" "bash -s -- $container $repository" <<'REMOTE'
set -euo pipefail
read -r running id ref < <(docker inspect --type container -f '{{.State.Running}} {{.Image}} {{.Config.Image}}' "$1")
[[ $running == true ]]
digests=$(docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$id")
for candidate in "$ref" $digests; do
    if [[ ${candidate%@*} == "$2" && ${candidate#*@} =~ ^sha256:[0-9a-f]{64}$ ]] &&
       grep -Fxq -- "$candidate" <<< "$digests"; then
        printf '%s\n' "$candidate"
        exit 0
    fi
done
echo "Cannot resolve running $1 to a registry digest in $2" >&2
exit 1
REMOTE
