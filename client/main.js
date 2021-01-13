const qs = document.querySelector.bind(document)

const peer = new Peer()

// Receive call
peer.on('call', (stream) => {
    const video = qs('#client-video')

    stream.on('stream', (stream) => {
        video.srcObject = stream
        video.addEventListener('loadedmetadata', () => {
            video.play()
        })
    })

    stream.on('close', () => {
        video.remove()
    })
})

qs('#join-button').addEventListener('click', () => {
    qs('main').classList.add('hidden-div')
    qs('.client').classList.remove('hidden-div')
})

qs('#host-button').addEventListener('click', () => {
    qs('main').classList.add('hidden-div')
    qs('.host').classList.remove('hidden-div')
})

qs('#select-screen-button').addEventListener('click', () => {

})