class DeleteFileForm extends ModalDialog {
  constructor() {
    super();

    const icon = document.createElement("modal-warning");
    this._header.insertBefore(icon, this._titleDiv);

    const warning = document.createElement("p");
    warning.setAttribute("class", "text-semibold py-3");
    warning.textContent = "Warning: This cannot be undone";
    this._main.appendChild(warning);

    this._accept = document.createElement("button");
    this._accept.setAttribute("class", "btn btn-clear btn-red");
    this._accept.textContent = "Delete File";
    this._footer.appendChild(this._accept);
    
    const cancel = document.createElement("button");
    cancel.setAttribute("class", "btn btn-clear btn-charcoal");
    cancel.textContent = "Cancel";
    this._footer.appendChild(cancel);

    cancel.addEventListener("click", this._closeCallback);
  }

  static get observedAttributes() {
    return ["media-id", "media-name"].concat(ModalDialog.observedAttributes);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    ModalDialog.prototype.attributeChangedCallback.call(this, name, oldValue, newValue);
    switch (name) {
      case "media-id":
        this._accept.addEventListener("click", async evt => {
          fetch("/rest/EntityMedia/" + newValue, {
            method: "DELETE",
            credentials: "same-origin",
            headers: {
              "X-CSRFToken": getCookie("csrftoken"),
              "Accept": "application/json",
              "Content-Type": "application/json"
            },
          })
          .then(response => window.location.reload(true))
          .catch(err => console.log(err));
        });
        break;
      case "media-name":
        this._title.nodeValue = "Delete \"" + newValue + "\"";
        break;
      case "is-open":
        break;
    }
  }
}

customElements.define("delete-file-form", DeleteFileForm);
