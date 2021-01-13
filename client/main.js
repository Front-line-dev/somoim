const qs = document.querySelector.bind(document)

const peer = new Peer()

const emptyStream = document.createElement('canvas').captureStream()


// Client
qs('#join-button').addEventListener('click', () => {
    qs('main').classList.add('hidden-div')
    qs('.client').classList.remove('hidden-div')

    // Receive call
    // peer.on('call', (connection) => {
    //     console.log('answered back')
    //     const video = qs('#client-video')

    //     connection.on('stream', (stream) => {
    //         video.srcObject = stream
    //         video.addEventListener('loadedmetadata', () => {
    //             video.play()
    //         })
    //     })

    //     connection.on('close', () => {
    //         video.remove()
    //     })
    // })
})

qs('#connect-form').addEventListener('submit', async (e) => {
    e.preventDefault()

    const peerID = qs('#host-id-input').value
    const connection = peer.call(peerID, emptyStream)

    const video = qs('#client-video')

    connection.on('stream', (stream) => {
        console.log('on stream')
        video.srcObject = stream
        video.addEventListener('loadedmetadata', () => {
            video.play()
        })
    })

    connection.on('close', () => {
        video.remove()
    })
    
})


// Host
qs('#host-button').addEventListener('click', () => {
    qs('main').classList.add('hidden-div')
    qs('.host').classList.remove('hidden-div')
})

qs('#select-screen-button').addEventListener('click', async () => {

    const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
            width: 1920,
            height: 1080,
            frameRate: 60
        },
        audio: true
    })

    const video = qs('#host-video')
    video.srcObject = stream
    video.play()

    console.log(peer.id)

    // Receive call
    peer.on('call', (connection) => {
        console.log('called')
        connection.answer(stream)
    })
})