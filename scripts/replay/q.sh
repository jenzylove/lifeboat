curl -s https://api.morpho.org/graphql -H 'content-type: application/json' -d "$(node -e 'console.log(JSON.stringify({query:process.argv[1]}))' "$1")"
