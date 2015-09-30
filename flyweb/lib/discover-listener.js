"use strict";

class DiscoverListenerList
{
  constructor() {
    this.listeners_ = [];
    this.idno_ = 0;
  }

  nextId() {
    let idno = ++this.idno_;
    return 'discover_listener_' + idno;
  }

  addListener(spec, callback)  {
    let id = this.nextId();
    let listener = new DiscoverListener({id, spec, callback});
    this.listeners_.push(listener);
    return id;
  }

  removeListener(id) {
    this.listeners_ = this.listeners_.filter((listener) => {
      return listener.id != id;
    });
  }

  found(service) {
    for (let listener of this.listeners_)
      listener.found(service);
  }

  lost(service) {
    for (let listener of this.listeners_)
      listener.lost(service);
  }
}

class DiscoverListener
{
  constructor({id, spec, callback}) {
    this.id_ = id;
    this.spec_ = spec;
    this.callback_ = callback;
  }

  get id() { return this.id_; }
  get spec() { return this.spec_; }
  get callback() { return this.callback_; }

  match_(service) {
    return true;
  }

  found(service) {
    if (this.callback_ && this.match_(service))
      this.callback_(service, true)
  }

  lost(service) {
    if (this.callback_ && this.match_(service))
      this.callback_(service, false)
  }
}

exports.DiscoverListenerList = DiscoverListenerList;
exports.DiscoverListener = DiscoverListener;
