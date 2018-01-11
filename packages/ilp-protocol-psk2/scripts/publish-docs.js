const ghpages = require('gh-pages')

console.log('Publishing docs to Github Pages...')

ghpages.publish('doc', {
  src: ['**/*', '\.nojekyll'],
  message: 'docs: [skip ci] Publish docs',
  repo: 'git@github.com:emschwartz/ilp-protocol-psk2.git',
  user: {
    name: 'CircleCI',
    email: 'none'
  }
}, function (err) {
  if (err) {
    console.log(err)
    process.exit(1)
  }

  console.log('Published docs')
})
