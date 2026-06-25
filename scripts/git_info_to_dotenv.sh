#!/bin/sh

FILE=.env

# Check if .env file exists
if [ ! -f ${FILE} ]; then
  # Create the .env file if it doesn't exist
  touch ${FILE}
fi

insert_entry() {
  local key="$1"
  local val="$2"
  if grep -q "${key}=" ${FILE}; then
    # nothing in this case
    break
  else
    echo "${key}=" >> ${FILE}
  fi
  tmp=$(mktemp)
  sed 's/'"${key}"'=.*/'"${key}=${val}"'/' ${FILE} > "${tmp}" && mv "${tmp}" ${FILE}
}

insert_entry "PUBLIC_APP_VERSION" "$(git describe --tags --always)"
insert_entry "PUBLIC_APP_COMMIT" "$(git rev-parse --short=8 HEAD)" 
