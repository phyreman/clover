(async function(){
	// Register the Service Worker, if able; then listen for app updates and prompt to upgrade
	let iSW, refreshingPage;
	if (location.protocol.includes("http")) {
		update_btn.addEventListener("click", () => iSW.postMessage({ action: "skipWaiting" }));

		navigator.serviceWorker.register("sw.js", { scope: location.pathname })
		.then(reg => {
			reg.addEventListener("updatefound", () => {
				iSW = reg.installing;
				iSW.addEventListener("statechange", function() {
					if (this.state !== "installed") return;
					if (navigator.serviceWorker.controller) update_btn.hidden = false;
				});
			});
		})
		.catch(err => alert(JSON.stringify(err)));

		// Reload the page after the serviceWorker controller has changed to the latest version
		navigator.serviceWorker.addEventListener("controllerchange", event => {
			if (refreshingPage) return;
			location.reload();
			refreshingPage = true;
		});
	}

	const canDetect = !!window.TextDetector,
				constraints = {
					video: {
						aspectRatio: 16/9,
						facingMode: "environment",
						width: screen.height,
						zoom: 1
					},
					audio: false
				},
				detector = canDetect && new TextDetector(),
				worker = !canDetect && Tesseract.createWorker({
					workerPath: "tesseract/worker.min.js",
					langPath: "tesseract/langs",
					corePath: "tesseract/tesseract-core.wasm.js",
					logger: p => {
						wait_status.textContent = p.status;
						load_meter.value = p.progress;
					}
				}),
				ctx = canvas.getContext("2d");
	let track;

	if (worker) {
		wait.showModal();
		await worker.load();
		load_meter.value++;
		await worker.loadLanguage("eng");
		load_meter.value++;
		await worker.initialize("eng");
		wait.close();
		load_meter.max = 1;
		load_meter.value = 0;
		ctx.scale(3, 3);
	}

	// Connect to the camera
	navigator.mediaDevices.getUserMedia(constraints)
	.then(stream => {
		track = stream.getVideoTracks()[0];
		if (track.getCapabilities().torch !== undefined) {
			torch.disabled = false;
			torch.hidden = false;
			torch.addEventListener("click", event => {
				track.applyConstraints({
					advanced: [{ torch: event.target.classList.contains("light-off") }]
				}).then(() => {
					event.target.classList.toggle("light-off");
				}).catch(err => {
					// If, for whatever reason, the light wasn't already disabled
					if (err.name === "NotSupportedError") {
						alert("Sorry, this device does not support the flashlight feature.");
						torch.disabled = true;
						torch.hidden = true;
					} else {
						alert(`Error: ${err.message}`);
					}
				});
			});
		}
		cam.srcObject = stream;
		cam.autoplay = true;
	})
	.catch(err => alert(err));

	cam.addEventListener("play", event => {
		cam.style.marginLeft = `calc(50vw - ${cam.videoWidth / 2}px)`;
		canvas.width = cam.videoWidth * 3;
		canvas.height = cam.videoHeight * 3;
	}, { once: true });

	cam.addEventListener("click", scan);

	output_dialog.addEventListener("close", function(event) {
		cam.play();
		if (this.returnValue === "") return;
		if (this.returnValue === "default") {
			// Form was submitted
			saveAs(output.textContent, "output.txt");
		}
	});

	async function scan() {
		if (detector) {
			detector
			.detect(cam)
			.then(texts => {
				if (texts.length < 1) return;
				output.textContent = texts.map(text => text.rawValue).join("\r\n");
				cam.pause();
				output_dialog.showModal();
			}).catch(err => alert(err));
		}
		if (worker) {
			// const { data: { text } } = await worker.recognize(cam);
			ctx.drawImage(cam, 0, 0, cam.videoWidth, cam.videoHeight);
			// const { data: { text } } = await worker.recognize(canvas);
			// const { data: { text } } = await worker.recognize(canvas.toDataURL("image/png"));
			cam.pause();
			wait.showModal();
			worker.recognize(canvas)
			.then(data => {
				const text = data.text;
				if (!text) return;
				output.textContent = text;
				cam.pause();
				wait.close();
				output_dialog.showModal();
			});
		}
	}

	const saveAs = (data, filename = "untitled", type = "text/plain") => {
		if (typeof data !== "string") throw TypeError("Input data must be of type String");
		const url = window.URL.createObjectURL(new Blob([data], { type }));
		const a = document.createElement('a');
		a.download = filename;
		a.href = url;
		a.style.display = "none";
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		window.URL.revokeObjectURL(url);
	};
})();