class EntitySelector extends TatorElement {
  constructor() {
    super();

    this._div = document.createElement("div");
    this._div.setAttribute("class", "d-flex flex-items-center flex-justify-between position-relative entity__selector");
    this._shadow.appendChild(this._div);

    this._expand = document.createElement("button");
    this._expand.setAttribute("class", "annotation__entity btn-clear px-4 col-12 css-truncate text-white");
    this._div.appendChild(this._expand);

    this._name = document.createElement("span");
    this._name.setAttribute("class", "text-semibold");
    this._expand.appendChild(this._name);

    this._count = document.createElement("span");
    this._count.setAttribute("class", "px-1 text-gray");
    this._expand.appendChild(this._count);

    const controls = document.createElement("div");
    controls.setAttribute("class", "annotation__entity-count d-flex flex-items-center px-4");
    this._div.appendChild(controls);

    const prev = document.createElement("entity-prev-button");
    controls.appendChild(prev);

    const details = document.createElement("details");
    details.setAttribute("class", "position-relative");
    controls.appendChild(details);

    const summary = document.createElement("summary");
    summary.setAttribute("class", "d-flex flex-items-center px-1");
    summary.style.cursor = "pointer";
    details.appendChild(summary);

    this._current = document.createElement("span");
    this._current.setAttribute("class", "px-1 text-gray");
    this._current.textContent = "0";
    summary.appendChild(this._current);

    const styleDiv = document.createElement("div");
    styleDiv.setAttribute("class", "files__main files-wrap");
    details.appendChild(styleDiv);

    const div = document.createElement("div");
    div.setAttribute("class", "more d-flex flex-column f2 py-3 px-2");
    styleDiv.appendChild(div);

    this._slider = document.createElement("input");
    this._slider.setAttribute("class", "range flex-grow");
    this._slider.setAttribute("type", "range");
    this._slider.setAttribute("step", "1");
    this._slider.setAttribute("min", "0");
    this._slider.setAttribute("value", "0");
    div.appendChild(this._slider);

    const next = document.createElement("entity-next-button");
    controls.appendChild(next);

    const del = document.createElement("entity-delete-button");
    del.style.marginLeft = "8px";
    del.style.display = "none";
    controls.appendChild(del);

    const capture = document.createElement("button");
    capture.setAttribute("class", "btn-clear d-flex flex-justify-center px-2 py-2 rounded-2 f2 text-white entity__button");
    capture.style.marginLeft="8px";
    capture.style.display="none";
    controls.appendChild(capture);

    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("height", "1em");
    svg.setAttribute("width", "1em");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("fill", "none");
    // override CSS for this icon
    svg.style.fill = "none";
    capture.appendChild(svg);

    const title = document.createElementNS(svgNamespace, "title");
    title.textContent = "Capture View";
    svg.appendChild(title);

    const path = document.createElementNS(svgNamespace, "path");
    path.setAttribute("d", "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z");
    svg.appendChild(path);

    const circle = document.createElementNS(svgNamespace, "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "13");
    circle.setAttribute("r", "4");
    svg.appendChild(circle);
    capture.appendChild(svg);

    const more = document.createElement("entity-more");
    controls.appendChild(more);

    this._expand.addEventListener("click", () => {
      this._div.classList.toggle("is-open");
      if (this._div.classList.contains("is-open")) {
        this.dispatchEvent(new Event("open"));
        this._emitSelection(true, true);
      } else {
        this.dispatchEvent(new Event("close"));
      }
    });

    prev.addEventListener("click", () => {
      const index = parseInt(this._current.textContent) - 1;
      if (index > 0) {
        this._current.textContent = String(index);
      }
      this._emitSelection(true, true);
    });

    next.addEventListener("click", () => {
      const index = parseInt(this._current.textContent) + 1;
      if (index <= this._data.length) {
        this._current.textContent = String(index);
      }
      this._emitSelection(true, true);
    });

    capture.addEventListener("click", () => {
      capture.blur();
      this._emitCapture();
    });

    del.addEventListener("click", () => {
      let endpoint;
      if (this._dataType.isLocalization) {
        endpoint = "Localization";
      } else {
        endpoint = "EntityState";
      }
      const index = parseInt(this._current.textContent) - 1;
      const evt = new CustomEvent("update", {detail: this._dataType});
      this._undo.del(endpoint, this._data[index].id, evt);
    });

    more.addEventListener("click", () => {
      if (del.style.display == "none") {
        del.style.display = "block";
        // Enable snapshots for boxes
        if (this._dataType.isLocalization &&
            this._dataType.type.dtype == "box") {
          capture.style.display = null;
        }
      } else {
        del.style.display = "none";
        capture.style.display = "none";
      }
    });

    details.addEventListener("click", () => {
      const detailsClosed = !details.hasAttribute("open");
      const attributesClosed = !this._div.classList.contains("is-open");
      if (detailsClosed && attributesClosed) {
        this._expand.click();
      }
      setTimeout(() => this._slider.focus(), 0);
    });

    this._slider.addEventListener("input", () => {
      this._current.textContent = String(Number(this._slider.value) + 1);
      this._emitSelection(true, true);
    });

    this._slider.addEventListener("blur", () => {
      details.removeAttribute("open");
    });
  }

  static get observedAttributes() {
    return ["name"];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    switch (name) {
      case "name":
        this._name.textContent = newValue;
        break;
    }
  }

  get data() {
    const index = parseInt(this._current.textContent) - 1;
    return this._data[index];
  }

  set dataType(val) {
    this._dataType = val;
  }

  set undoBuffer(val) {
    this._undo = val;
  }

  update(data) {
    this._data = data;
    this._count.textContent = String(data.length);
    const haveData = data.length > 0;
    const current = parseInt(this._current.textContent);
    this._slider.max = data.length - 1;
    if (haveData && (current == 0)) {
      this._current.textContent = "1";
      this._slider.value = 0;
    }
    if (haveData && (current > data.length)) {
      this._current.textContent = String(data.length);
      this._slider.value = data.length - 1;
    }
    this._emitSelection(false, true);
  }

  selectEntity(obj) {
    for (const [index, data] of this._data.entries()) {
      if (data.id == obj.id) {
        this._div.classList.add("is-open");
        this.dispatchEvent(new Event("open"));
        this._current.textContent = String(index + 1);
        this._slider.value = index;
      }
    }
    this._emitSelection(false, false);
  }

  _emitSelection(byUser, composed) {
    const index = parseInt(this._current.textContent) - 1;
    this.dispatchEvent(new CustomEvent("select", {
      detail: {
        data: this._data[index],
        dataType: this._dataType,
        byUser: byUser
      },
      composed: composed,
    }));
  }

  _emitCapture() {
    const index = parseInt(this._current.textContent) - 1;
    this.dispatchEvent(new CustomEvent("capture", {
      detail: {
        data: this._data[index],
        dataType: this._dataType,
      },
      composed: true,
    }));
  }
}

customElements.define("entity-selector", EntitySelector);
