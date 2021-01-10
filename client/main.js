document.querySelector('#join-button').addEventListener('click', () => {
    document.querySelector('main').classList.add('hidden-div')
    document.querySelector('.client').classList.remove('hidden-div')
})

document.querySelector('#host-button').addEventListener('click', () => {
    document.querySelector('main').classList.add('hidden-div')
    document.querySelector('.host').classList.remove('hidden-div')
})