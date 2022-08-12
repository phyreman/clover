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
				detector = canDetect && new TextDetector(),
				worker = !canDetect && Tesseract.createWorker({
					workerPath: "tesseract/worker.min.js",
					langPath: "tesseract/langs",
					corePath: "tesseract/tesseract-core.wasm.js",
					logger: p => {
						wait_status.textContent = p.status;
						load_meter.value = p.progress;
					}
				});

	if (!(detector || worker)) {
		alert("Failed to create a valid detector, aborting...");
		return;
	}

	const constraints = {
					video: {
						aspectRatio: 16/9,
						// aspectRatio: 9/16,
						facingMode: "environment",
						width: screen.height,
						// height: screen.width,
						zoom: 1
					},
					audio: false
				},
				ctx = canvas.getContext("2d"),
				scale = 2;

	ctx.scale(scale, scale);

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
	}

	let track, offset, lastPoint, isDragging = false;

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
		offset = getOffset(cam);
		canvas.width = cam.videoWidth * scale;
		canvas.height = cam.videoHeight * scale;
	}, { once: true });

	cam.addEventListener("click", scan);

	output_dialog.addEventListener("close", function(event) {
		cropper.hidden = true;
		crop_controls.hidden = true;
		cam.play();
		this.returnValue === "default" && saveAs(output.textContent, "output.txt");
	});

	cropper.addEventListener("mousedown", handleMouseDown);
	cropper.addEventListener("touchstart", handleMouseDown);
	document.body.addEventListener("mousemove", handleMouseMove);
	document.body.addEventListener("touchmove", handleMouseMove, { passive: false });
	cropper.addEventListener("mouseup", handleMouseUp);
	cropper.addEventListener("touchend", handleMouseUp);

	crop.addEventListener("click", async event => {
		const { left, top, height, width } = cropper.getBoundingClientRect();
		if (detector) {
			canvas.width = width * scale;
			canvas.height = height * scale;
			ctx.drawImage(cam, left - offset.x, top - offset.y, width, height, 0, 0, canvas.width, canvas.height);
			detector
			.detect(canvas)
			.then(texts => {
				if (texts.length < 1) return;
				output.textContent = texts.map(text => text.rawValue).join("\r\n");
				output_dialog.showModal();
			}).catch(err => alert(err));
			return;
		}
		ctx.drawImage(cam, 0, 0, canvas.width, canvas.height);
		wait.showModal();
		const { data: { text } } = await worker.recognize(canvas, { rectangle: { left: left - offset.x, top: top - offset.y, height: height * scale, width: width * scale } });
		wait.close();
		load_meter.value = 0;
		if (!text) return;
		output.textContent = text;
		output_dialog.showModal();
	});
	nocrop.addEventListener("click", async event => {
		if (detector) {
			detector
			.detect(cam)
			.then(texts => {
				if (texts.length < 1) return;
				output.textContent = texts.map(text => text.rawValue).join("\r\n");
				output_dialog.showModal();
			}).catch(err => alert(err));
			return;
		}
		ctx.drawImage(cam, 0, 0, canvas.width, canvas.height);
		wait.showModal();
		const { data: { text } } = await worker.recognize(canvas);
		wait.close();
		load_meter.value = 0;
		if (!text) return;
		output.textContent = text;
		output_dialog.showModal();
	});

	function getOffset(element) {
		let x = 0, y = 0;

		if (element.offsetParent !== undefined) {
			do {
				x += element.offsetLeft;
				y += element.offsetTop;
			} while ((element = element.offsetParent));
		}

		return { x, y };
	}

	function getMouse(e) {
		return {
			x: (e.pageX || e.touches[0].clientX || 0) - offset.x,
			y: (e.pageY || e.touches[0].clientY || 0) - offset.y
		};
	}

	function handleMouseDown(e) {
		lastPoint = getMouse(e);
		const x = lastPoint.x - (cropper.offsetLeft - offset.x),
					y = lastPoint.y - cropper.offsetTop,
					{ width, height } = cropper.getBoundingClientRect();
		if (!(x >= width - 19 && y >= height - 19)) isDragging = true;
	}

	function handleMouseMove(e) {
		if (!isDragging) return;

		e.preventDefault();

		const currentPoint = getMouse(e),
					x = lastPoint.x - currentPoint.x,
					y = lastPoint.y - currentPoint.y;
		lastPoint = currentPoint;

		cropper.style.left = `${cropper.offsetLeft - x}px`;
		cropper.style.top = `${cropper.offsetTop - y}px`;
	}

	function handleMouseUp(e) {
		isDragging = false;
		lastPoint = null;
	}

	function scan() {
		cam.pause();
		cropper.hidden = false;
		crop_controls.hidden = false;
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