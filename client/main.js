const qs = document.querySelector.bind(document)

const peer = new Peer()

const emptyStream = document.createElement('canvas').captureStream()

const sdpTransform = (sdp) => {
    console.log(sdp)
    // sdp = sdp.replace('a=mid:0', 'a=mid:0\r\nb=AS:500')
    // sdp = sdp.replace('VP8/90000', 'H264/90000')
    sdp = sdp.replace('a=rtcp-fb:96 nack pli', 'a=rtcp-fb:96 nack pli\r\na=rtcp-fb:96 max-br=10000\r\na=rtcp-fb:96 max-smbps=20000')
    console.log(sdp)
    return sdp
}


// Client
qs('#join-button').addEventListener('click', () => {
    qs('main').classList.add('hidden-div')
    qs('.client').classList.remove('hidden-div')
})

qs('#connect-form').addEventListener('submit', async (e) => {
    e.preventDefault()

    const peerID = qs('#host-id-input').value
    const connection = peer.call(peerID, emptyStream, {sdpTransform})

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

    qs('#peer-id-display').value = peer.id
    qs('#copy-id-button').addEventListener('click', () => {
        navigator.clipboard.writeText(peer.id)
    })
})

qs('#select-screen-button').addEventListener('click', async () => {

    const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
            width: 1280,
            height: 720,
            frameRate: 60,
        },
        audio: false
    })

    const video = qs('#host-video')
    video.srcObject = stream
    video.play()

    console.log(peer.id)

    // Receive call
    peer.on('call', (connection) => {
        console.log('called')
        connection.answer(stream, {sdpTransform})
    })
})