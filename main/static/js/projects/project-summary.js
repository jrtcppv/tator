class ProjectSummary extends TatorElement {
  constructor() {
    super();

    const div = document.createElement("div");
    div.setAttribute("class", "projects d-flex flex-items-center rounded-2");
    this._shadow.appendChild(div);

    this._link = document.createElement("a");
    this._link.setAttribute("class", "projects__link d-flex flex-items-center text-white");
    div.appendChild(this._link);

    this._img = document.createElement("img");
    this._img.setAttribute("class", "projects__image px-2 rounded-1");
    this._link.appendChild(this._img);

    const text = document.createElement("div");
    text.setAttribute("class", "projects__text px-3");
    this._link.appendChild(text);

    const h2 = document.createElement("h2");
    h2.setAttribute("class", "text-semibold py-2");
    text.appendChild(h2);

    this._text = document.createTextNode("");
    h2.appendChild(this._text);

    this._description = document.createElement("project-description");
    text.appendChild(this._description);

    this._collaborators = document.createElement("div");
    this._collaborators.setAttribute("class", "projects__collaborators avatars d-flex");
    div.appendChild(this._collaborators);

    this._nav = document.createElement("project-nav");
    div.appendChild(this._nav);
  }

  set info(val) {
    this._text.nodeValue = val.name;
    if (val.thumb) {
      this._img.setAttribute("src", val.thumb);
      this._img.setAttribute("style", "object-fit:cover");
    } else {
      this._img.setAttribute("src", "/static/images/cvision-logo-svg.svg");
      this._img.setAttribute("style", "object-fit:contain");
    }
    const url = window.location.origin + "/" + val.id + "/project-detail";
    this._link.setAttribute("href", url);
    this._description.setAttribute("num-files", val.num_files);
    this._description.setAttribute("size", val.size);
    this._nav.setAttribute("project-id", val.id);
    let first = true;
    for (let username of val.usernames) {
      const span = document.createElement("span");
      span.setAttribute("class", "avatar circle d-flex flex-items-center flex-justify-center f3");
      if (!first) {
        span.setAttribute("style", "background-color: #696cff");
      }
      let initials = username.match(/\b\w/g) || [];
      initials = ((initials.shift() || '') + (initials.pop() || '')).toUpperCase();
      span.textContent = initials;
      this._collaborators.appendChild(span);
      first = false;
    }

    this._nav.addEventListener("remove", evt => {
      const remove = new CustomEvent("remove", {
        detail: {
          projectId: val.id,
          projectName: val.name,
        }
      });
      this.dispatchEvent(remove);
    });
  }
}

customElements.define("project-summary", ProjectSummary);
